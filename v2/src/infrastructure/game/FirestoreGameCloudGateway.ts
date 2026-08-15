// Firestore-implementatie van GameCloudGateway (PR 7.1c,
// docs/pr-7.1-plan.md §C 7.1c werk 1-3). Bewaart
// organizations/{orgId}/teams/{teamId}/games/{gameId} en de
// actions/{actionId}-subcollectie (spiegelt firebase/firestore.rules §games —
// PR 7.1b), en gebruikt gameConverter/gameActionConverter uit
// firebase-base/documents voor typed reads. Net als
// FirestoreSettingsRepository schrijft dit adapter-laag RAUW (geen
// `.withConverter()`) — de converter is er voor het lezen/valideren, niet om
// een write-payload te vertalen (`toFirestore()` is bij beide documenten een
// identity-pass-through).
//
// Drie bewuste verschillen met FirestoreSettingsRepository/FirestoreRosterRepository:
// 1. Elke Firestore-aanroep hier is aan een timeout gebonden (`withTimeout`).
//    PR 5.3d ontdekte dat setDoc()/getDoc() op ÉÉN document offline onbeperkt
//    kunnen blijven hangen (issue #27) — settings/roster lossen dat op door
//    write() nooit op de eigen serverbevestiging te laten wachten
//    (fire-and-forget + apart `settled`-Promise). Voor games moet
//    `GameSyncCoordinator` een synchrone (voor deze sync-cyclus) JA/NEE op
//    "is dit bevestigd" hebben om de lokale checkpoint correct bij te
//    werken — dus wordt hier wél gewacht, maar met een harde bovengrens, zodat
//    een hang nooit de UI blokkeert en altijd als retrybare `ok:false`
//    terugkomt (ADR-002 punt "Actie nodig", docs/pr-7.1-plan.md §C 7.1c
//    acceptatiecriterium 3).
// 2. `uploadActions()` behandelt een afgewezen create NIET automatisch als
//    fout: firestore.rules staat alleen `create` toe op een action-document
//    (nooit `update`), dus een retry met dezelfde `actionId` botst altijd op
//    een permission-denied als het document al bestaat. Een readback
//    onderscheidt "al aanwezig met identieke payload" (`alreadyConfirmed`)
//    van een echt integriteitsconflict (ADR-002 §"Verduidelijkingen voor fase
//    7" punt 1).
// 3. `patchSnapshot()` gebruikt geen transactie — firestore.rules dwingt de
//    optimistische-concurrencycontrole al af (`revision == resource.data.revision + 1`,
//    PR 7.1b punt 10a/10b): een niet-transactionele `updateDoc()` op een
//    verouderde `expectedRevision` wordt simpelweg geweigerd. Zie
//    docs/pr-7.1-plan.md §C 7.1c werk 2.
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import {
  completedGameConverter,
  gameActionConverter,
  gameConverter,
  type GameActionEnvelopeDocument,
} from 'firebase-base/documents';
import type {
  CompletedGameSnapshotProjection,
  CompletedGameWriteResult,
  GameActionUploadOutcome,
  GameCloudGateway,
  GameSnapshotProjection,
  GameSnapshotWriteResult,
} from '../../application/game/GameCloudGateway';

const DEFAULT_TIMEOUT_MS = 8000;

class GameSyncTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label}: geen serverantwoord binnen ${ms}ms`);
    this.name = 'GameSyncTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GameSyncTimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Ordeloze structurele vergelijking voor JSON-achtige waarden (geen `Date`/
 * `Timestamp`/functies — action-envelopes bestaan uitsluitend uit strings,
 * getallen, booleans, arrays en platte objecten). Gebruikt om te bepalen of
 * een reeds aanwezig action-document semantisch gelijk is aan een retry
 * (`alreadyConfirmed`) i.p.v. `JSON.stringify`, dat gevoelig is voor
 * sleutelvolgorde tussen twee onafhankelijk opgebouwde objectliterals.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(bRecord, key) &&
          deepEqual(aRecord[key], bRecord[key]),
      )
    );
  }
  return false;
}

export class FirestoreGameCloudGateway implements GameCloudGateway {
  constructor(
    private readonly db: Firestore,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  private gameRef(organizationId: string, teamId: string, gameId: string): DocumentReference {
    return doc(this.db, 'organizations', organizationId, 'teams', teamId, 'games', gameId);
  }

  private actionRef(
    organizationId: string,
    teamId: string,
    gameId: string,
    actionId: string,
  ): DocumentReference {
    return doc(
      this.db,
      'organizations',
      organizationId,
      'teams',
      teamId,
      'games',
      gameId,
      'actions',
      actionId,
    );
  }

  private completedGameRef(
    organizationId: string,
    teamId: string,
    completedGameId: string,
  ): DocumentReference {
    return doc(
      this.db,
      'organizations',
      organizationId,
      'teams',
      teamId,
      'completedGames',
      completedGameId,
    );
  }

  async ensureGame(
    organizationId: string,
    teamId: string,
    gameId: string,
    snapshot: GameSnapshotProjection,
  ): Promise<GameSnapshotWriteResult> {
    const ref = this.gameRef(organizationId, teamId, gameId);
    try {
      const existing = await withTimeout(
        getDoc(ref.withConverter(gameConverter)),
        this.timeoutMs,
        'ensureGame:getDoc',
      );
      if (existing.exists()) {
        const data = existing.data();
        return {
          ok: true,
          revision: data.revision,
          writerUid: data.writerUid,
          deviceId: data.deviceId,
          completedGameId: data.completedGameId,
        };
      }
      await withTimeout(
        setDoc(ref, { ...snapshot, updatedAt: serverTimestamp() }),
        this.timeoutMs,
        'ensureGame:setDoc',
      );
      return {
        ok: true,
        revision: snapshot.revision,
        writerUid: snapshot.writerUid,
        deviceId: snapshot.deviceId,
        completedGameId: snapshot.completedGameId,
      };
    } catch (createError) {
      // Race met een ander apparaat dat het document tussen onze getDoc() en
      // setDoc() al aanmaakte: firestore.rules verwerpt onze create-payload
      // dan als (ongeldige) update. Een verse readback levert alsnog een
      // bruikbaar "het bestaat al"-resultaat op i.p.v. dit als harde fout te
      // melden — `ensureGame()` belooft alleen "bestaat na deze call", niet
      // "ik heb 'm gemaakt".
      try {
        const readback = await withTimeout(
          getDoc(ref.withConverter(gameConverter)),
          this.timeoutMs,
          'ensureGame:readback',
        );
        if (readback.exists()) {
          const data = readback.data();
          return {
            ok: true,
            revision: data.revision,
            writerUid: data.writerUid,
            deviceId: data.deviceId,
            completedGameId: data.completedGameId,
          };
        }
      } catch {
        /* val door naar de oorspronkelijke fout hieronder */
      }
      return { ok: false, error: createError };
    }
  }

  async uploadActions(
    organizationId: string,
    teamId: string,
    gameId: string,
    actions: readonly GameActionEnvelopeDocument[],
  ): Promise<GameActionUploadOutcome[]> {
    const outcomes: GameActionUploadOutcome[] = [];
    for (const action of actions) {
      const ref = this.actionRef(organizationId, teamId, gameId, action.actionId);
      try {
        await withTimeout(setDoc(ref, action), this.timeoutMs, 'uploadActions:setDoc');
        outcomes.push({ actionId: action.actionId, ok: true });
      } catch (createError) {
        try {
          const existing = await withTimeout(
            getDoc(ref.withConverter(gameActionConverter)),
            this.timeoutMs,
            'uploadActions:readback',
          );
          if (existing.exists() && deepEqual(existing.data(), action)) {
            outcomes.push({ actionId: action.actionId, ok: true, alreadyConfirmed: true });
            continue;
          }
        } catch {
          /* geen bruikbare readback — val door naar het oorspronkelijke faalresultaat */
        }
        outcomes.push({ actionId: action.actionId, ok: false, error: createError });
      }
    }
    return outcomes;
  }

  async patchSnapshot(
    organizationId: string,
    teamId: string,
    gameId: string,
    patch: Partial<GameSnapshotProjection>,
    expectedRevision: number,
  ): Promise<GameSnapshotWriteResult> {
    const ref = this.gameRef(organizationId, teamId, gameId);
    const nextRevision = expectedRevision + 1;
    try {
      await withTimeout(
        updateDoc(ref, { ...patch, revision: nextRevision, updatedAt: serverTimestamp() }),
        this.timeoutMs,
        'patchSnapshot:updateDoc',
      );
    } catch (error) {
      // Faalt bijv. bij een verouderde revisie (concurrency) of een
      // Rules-afwijzing (bv. writerUid komt niet meer overeen na een
      // toekomstige PR 7.3-overname) — altijd retrybaar/zichtbaar, nooit een
      // lokale actie verwijderen (docs/pr-7.1-plan.md §C 7.1c acceptatie 2/3).
      return { ok: false, error };
    }
    // Best-effort readback: de voorgaande updateDoc() is zelf al de
    // serverbevestiging (deze Firestore Web SDK-versie resolvet setDoc()/
    // updateDoc() pas na ack, zie FirestoreSettingsRepository's
    // headercommentaar) — een readback hierna is een extra waarborg, geen
    // vereiste voor correctheid. Als readback zelf faalt/timet-out (nadat de
    // write al aantoonbaar slaagde) blijft de write dus geldig: opnieuw als
    // `ok:false` melden zou de coordinator ten onrechte laten denken dat de
    // patch niet is doorgekomen en 'm laten hersturen met een nu-verouderde
    // `expectedRevision`, wat zelf weer als (schijnbaar) conflict zou falen.
    try {
      const readback = await withTimeout(
        getDoc(ref.withConverter(gameConverter)),
        this.timeoutMs,
        'patchSnapshot:readback',
      );
      if (readback.exists()) {
        const data = readback.data();
        return {
          ok: true,
          revision: data.revision,
          writerUid: data.writerUid,
          deviceId: data.deviceId,
          completedGameId: data.completedGameId,
        };
      }
    } catch {
      /* zie toelichting hierboven — de write zelf staat al vast */
    }
    return {
      ok: true,
      revision: nextRevision,
      writerUid: patch.writerUid,
      deviceId: patch.deviceId,
      completedGameId: patch.completedGameId,
    };
  }

  async ensureCompletedGame(
    organizationId: string,
    teamId: string,
    completedGameId: string,
    snapshot: CompletedGameSnapshotProjection,
  ): Promise<CompletedGameWriteResult> {
    const ref = this.completedGameRef(organizationId, teamId, completedGameId);
    try {
      await withTimeout(
        setDoc(ref, { ...snapshot, syncedAt: serverTimestamp() }),
        this.timeoutMs,
        'ensureCompletedGame:setDoc',
      );
      return { ok: true };
    } catch (createError) {
      // Zelfde patroon als uploadActions(): firestore.rules staat alleen
      // `create` toe op completedGames (nooit `update`), dus een retry met
      // dezelfde completedGameId botst altijd op een permission-denied als
      // het document al bestaat. Readback onderscheidt "al aanwezig met
      // identieke payload" (alreadyConfirmed) van een echt conflict.
      try {
        const existing = await withTimeout(
          getDoc(ref.withConverter(completedGameConverter)),
          this.timeoutMs,
          'ensureCompletedGame:readback',
        );
        if (existing.exists()) {
          const { syncedAt: _syncedAt, ...rest } = existing.data();
          void _syncedAt;
          if (deepEqual(rest, snapshot)) {
            return { ok: true, alreadyConfirmed: true };
          }
        }
      } catch {
        /* geen bruikbare readback — val door naar het oorspronkelijke faalresultaat */
      }
      return { ok: false, error: createError };
    }
  }
}
