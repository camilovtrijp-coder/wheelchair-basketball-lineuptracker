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
// 4. `finalizeCompletedGame()` (PR 7.2a, P1-fix externe review PR #61) is de
//    ENIGE methode hier die wél een `WriteBatch` gebruikt: de completed-
//    snapshot-create en de parent-finalize-patch moeten atomisch samen
//    slagen of samen falen (firestore.rules' `getAfter()`-binding, zie
//    firestore.rules punt 16) — twee losse writes lieten voorheen een
//    dubbele-snapshot/orphan-snapshot-gat open.
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import {
  gameActionConverter,
  gameConverter,
  type GameActionEnvelopeDocument,
} from 'firebase-base/documents';
import type {
  CompletedGameSnapshotProjection,
  CompletedGameTombstoneResult,
  GameActionUploadOutcome,
  GameCloudGateway,
  GameCloudSubscriptionCallbacks,
  GameCloudUnsubscribe,
  GameSnapshotProjection,
  GameSnapshotWriteResult,
} from '../../application/game/GameCloudGateway';
import type { WriterClaimResult } from '../../domain/game/writerClaim';

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

  private actionsCollectionRef(organizationId: string, teamId: string, gameId: string) {
    return collection(
      this.db,
      'organizations',
      organizationId,
      'teams',
      teamId,
      'games',
      gameId,
      'actions',
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
          writerEpoch: data.writerEpoch,
          claimedAt: data.claimedAt,
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
        writerEpoch: snapshot.writerEpoch,
        claimedAt: snapshot.claimedAt,
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
            writerEpoch: data.writerEpoch,
            claimedAt: data.claimedAt,
            completedGameId: data.completedGameId,
          };
        }
      } catch {
        /* val door naar de oorspronkelijke fout hieronder */
      }
      return { ok: false, error: createError };
    }
  }

  /**
   * Best-effort foutclassificatie voor `claimWriter()`/`takeoverWriter()`
   * (PR 7.3a): een geweigerde `updateDoc()` komt van Firestore altijd terug
   * als een kale permission-denied — deze readback onderscheidt WAAROM (voor
   * de pre-game-gate/overname-UI se NL/EN-herstelactie per `WriterClaimErrorCode`,
   * zie domain/game/writerClaim.ts). Geen garantie: de server-staat kan
   * tussen de mislukte write en deze readback alweer veranderd zijn — in dat
   * geval valt dit terug op de dichtstbijzijnde plausibele code, nooit een
   * harde crash.
   */
  private async classifyClaimFailure(
    ref: DocumentReference,
    error: unknown,
    expected: { revision: number; requireUnclaimed?: boolean; requireEpoch?: number },
  ): Promise<WriterClaimResult> {
    if (error instanceof GameSyncTimeoutError) {
      return { ok: false, code: 'offline', error };
    }
    try {
      const readback = await withTimeout(
        getDoc(ref.withConverter(gameConverter)),
        this.timeoutMs,
        'classifyClaimFailure:readback',
      );
      if (readback.exists()) {
        const data = readback.data();
        if (data.completedGameId != null) return { ok: false, code: 'game-completed', error };
        if (data.revision !== expected.revision)
          return { ok: false, code: 'stale-revision', error };
        if (expected.requireUnclaimed && data.writerUid != null) {
          return { ok: false, code: 'already-claimed', error };
        }
        if (expected.requireEpoch != null && data.writerEpoch !== expected.requireEpoch) {
          return { ok: false, code: 'already-claimed', error };
        }
        // Document staat er precies zo bij als verwacht — de enige overgebleven
        // plausibele weigeringsreden is dan de rol van de aanroeper zelf.
        return { ok: false, code: 'role-denied', error };
      }
    } catch {
      /* readback zelf faalde ook — val door naar 'unknown' hieronder */
    }
    return { ok: false, code: 'unknown', error };
  }

  /**
   * PR 7.3a (docs/pr-7.3-plan.md §B/§C 7.3a werk 2): initiële claim, spiegelt
   * firestore.rules' 10b-pad. Geen `runTransaction()` nodig: Firestore
   * serialiseert schrijfacties per document en Rules herevalueren
   * `resource.data` tegen de LAATSTE servertoestand bij elke write — een
   * `revision`-mismatch (concurrency) of een `writerUid != null` (een ander
   * apparaat won de claimrace) wordt daardoor al server-side geweigerd, exact
   * dezelfde garantie als een client-transactie hier zou bieden (zie ook
   * `patchSnapshot()` hierboven, die dezelfde redenering al toepast op de
   * draaiveldpatch). De voorgaande `updateDoc()` slagen IS de
   * serverbevestiging; geen aparte readback nodig voor het succespad.
   */
  async claimWriter(
    organizationId: string,
    teamId: string,
    gameId: string,
    writer: { authorUid: string; deviceId: string },
    expectedRevision: number,
    now: string,
  ): Promise<WriterClaimResult> {
    const ref = this.gameRef(organizationId, teamId, gameId);
    const nextRevision = expectedRevision + 1;
    try {
      await withTimeout(
        updateDoc(ref, {
          writerUid: writer.authorUid,
          deviceId: writer.deviceId,
          claimedAt: now,
          lastWriterActivityAt: now,
          revision: nextRevision,
          updatedAt: serverTimestamp(),
        }),
        this.timeoutMs,
        'claimWriter:updateDoc',
      );
    } catch (error) {
      return this.classifyClaimFailure(ref, error, {
        revision: expectedRevision,
        requireUnclaimed: true,
      });
    }
    return {
      ok: true,
      // Een ongeclaimd document (writerUid == null) heeft per constructie
      // altijd writerEpoch == 0 — epoch verandert uitsluitend via een 10d-
      // overname, en die vereist juist een AL geclaimd document. Zie
      // firestore.rules punt 18.
      identity: { writerUid: writer.authorUid, deviceId: writer.deviceId, writerEpoch: 0 },
      revision: nextRevision,
      claimedAt: now,
    };
  }

  /**
   * PR 7.3a (docs/pr-7.3-plan.md §B/§C 7.3a werk 2): overname van een AL
   * geclaimd document, spiegelt firestore.rules' 10d-pad — zelfde
   * geen-transactie-redenering als `claimWriter()` hierboven. `expectedEpoch`
   * is het epoch dat de aanroeper kende vóór de overnamebeslissing; de
   * server-Rule eist dat het NIEUWE epoch daar exact 1 boven ligt, dus een
   * race met een andere, inmiddels al gelukte overname wordt hier altijd
   * geweigerd (nooit twee overnames die allebei "winnen").
   */
  async takeoverWriter(
    organizationId: string,
    teamId: string,
    gameId: string,
    writer: { authorUid: string; deviceId: string },
    expectedEpoch: number,
    expectedRevision: number,
    now: string,
  ): Promise<WriterClaimResult> {
    const ref = this.gameRef(organizationId, teamId, gameId);
    const nextRevision = expectedRevision + 1;
    const nextEpoch = expectedEpoch + 1;
    try {
      await withTimeout(
        updateDoc(ref, {
          writerUid: writer.authorUid,
          deviceId: writer.deviceId,
          writerEpoch: nextEpoch,
          claimedAt: now,
          lastWriterActivityAt: now,
          revision: nextRevision,
          updatedAt: serverTimestamp(),
        }),
        this.timeoutMs,
        'takeoverWriter:updateDoc',
      );
    } catch (error) {
      return this.classifyClaimFailure(ref, error, {
        revision: expectedRevision,
        requireEpoch: expectedEpoch,
      });
    }
    return {
      ok: true,
      identity: { writerUid: writer.authorUid, deviceId: writer.deviceId, writerEpoch: nextEpoch },
      revision: nextRevision,
      claimedAt: now,
    };
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
          writerEpoch: data.writerEpoch,
          claimedAt: data.claimedAt,
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
      writerEpoch: patch.writerEpoch,
      claimedAt: patch.claimedAt,
      completedGameId: patch.completedGameId,
    };
  }

  /**
   * P1-fix (externe review PR #61) op de eerdere PR 7.2a-poort: schrijft de
   * completed-snapshot ÉN patcht `completedGameId` op het parentdocument als
   * ÉÉN atomische `WriteBatch` — nooit de twee losse `setDoc()`/`updateDoc()`-
   * aanroepen van eerst. Firestore's batched writes zijn all-or-nothing (en
   * `getAfter()` in firestore.rules' `completedGames`-createregel, punt 16,
   * ziet de UITKOMST van deze batch — dat werkt zowel binnen transacties als
   * batched writes): als de finalize-patch op het parentdocument faalt (bijv.
   * een verouderde `expectedRevision`, of `completedGameId` is server-side
   * intussen al door een eerdere poging gezet), wordt de completed-snapshot
   * NOOIT aangemaakt, en omgekeerd. Geen readback/alreadyConfirmed-dans meer
   * nodig zoals bij `uploadActions()` — idempotentie bij een retry loopt via
   * `GameSyncCoordinator.finalize()`'s eigen server-kortsluitingscheck
   * (`ensureGame()` vóóraf), niet via deze methode zelf.
   */
  async finalizeCompletedGame(
    organizationId: string,
    teamId: string,
    gameId: string,
    completedGameId: string,
    snapshot: CompletedGameSnapshotProjection,
    expectedRevision: number,
  ): Promise<GameSnapshotWriteResult> {
    const completedRef = this.completedGameRef(organizationId, teamId, completedGameId);
    const gameRef = this.gameRef(organizationId, teamId, gameId);
    const nextRevision = expectedRevision + 1;
    const batch = writeBatch(this.db);
    batch.set(completedRef, { ...snapshot, syncedAt: serverTimestamp() });
    batch.update(gameRef, {
      completedGameId,
      revision: nextRevision,
      updatedAt: serverTimestamp(),
    });
    try {
      await withTimeout(batch.commit(), this.timeoutMs, 'finalizeCompletedGame:commit');
    } catch (error) {
      // Faalt altijd atomisch: geen partiële staat om op terug te vallen.
      // Retrybaar/zichtbaar via een nieuwe finalize()-cyclus.
      return { ok: false, error };
    }
    // Best-effort readback, zelfde redenering als patchSnapshot() hierboven:
    // de voorgaande batch.commit() is zelf al de serverbevestiging.
    try {
      const readback = await withTimeout(
        getDoc(gameRef.withConverter(gameConverter)),
        this.timeoutMs,
        'finalizeCompletedGame:readback',
      );
      if (readback.exists()) {
        const data = readback.data();
        return {
          ok: true,
          revision: data.revision,
          writerUid: data.writerUid,
          deviceId: data.deviceId,
          writerEpoch: data.writerEpoch,
          claimedAt: data.claimedAt,
          completedGameId: data.completedGameId,
        };
      }
    } catch {
      /* zie toelichting hierboven — de write zelf staat al vast */
    }
    return { ok: true, revision: nextRevision, completedGameId };
  }

  /**
   * PR 7.2c: niet-transactioneel, net als `patchSnapshot()` hierboven —
   * firestore.rules dwingt de optimistische-concurrencycheck
   * (`revision == resource.data.revision + 1`) en het `deletedAt == null`-
   * vóórwaarde al af, dus een verouderde `expectedRevision` of een dubbele
   * tombstone-poging wordt simpelweg geweigerd, geen race om te winnen.
   */
  async tombstoneCompletedGame(
    organizationId: string,
    teamId: string,
    completedGameId: string,
    deletedBy: string,
    expectedRevision: number,
  ): Promise<CompletedGameTombstoneResult> {
    const ref = this.completedGameRef(organizationId, teamId, completedGameId);
    const nextRevision = expectedRevision + 1;
    try {
      await withTimeout(
        updateDoc(ref, {
          deletedAt: serverTimestamp(),
          deletedBy,
          revision: nextRevision,
        }),
        this.timeoutMs,
        'tombstoneCompletedGame:updateDoc',
      );
    } catch (error) {
      return { ok: false, error };
    }
    return { ok: true, revision: nextRevision };
  }

  /**
   * PR 7.3b (docs/pr-7.3-plan.md §C 7.3b werk 2): twee onafhankelijke
   * `onSnapshot()`-listeners (parent + `actions`-query op `sequence`), elk
   * met `includeMetadataChanges: true` zodat `onParent`/`onActions` ook
   * vuurt zodra een snapshot van "cache" naar "server-bevestigd" overgaat
   * (nodig voor de cache-/serveractualiteitsindicator, werk 3) — niet alleen
   * bij een echte datawijziging. Geen `withTimeout()` hier: dat patroon is
   * voor request/response-aanroepen met een zinvolle "geen antwoord binnen
   * Xms"-grens; een live listener heeft geen zo'n eindtoestand — hij blijft
   * per ontwerp open totdat de aanroeper afmeldt of Firestore zelf een
   * fatale listenerfout meldt (`onError` hieronder). Elke listener meldt
   * zijn eigen fouten onafhankelijk — een fout op de ene stopt de andere
   * niet, zodat de aanroeper desgewenst nog gedeeltelijke data kan tonen.
   */
  subscribeToGame(
    organizationId: string,
    teamId: string,
    gameId: string,
    callbacks: GameCloudSubscriptionCallbacks,
  ): GameCloudUnsubscribe {
    const gameRef = this.gameRef(organizationId, teamId, gameId).withConverter(gameConverter);
    // Review-fix (minimax, PR #68 punt 7): deze `orderBy('sequence')` draait
    // vandaag op Firestore's automatische single-field index — geen entry in
    // `firestore.indexes.json` nodig. Zodra hier ooit een `where()` aan
    // toegevoegd wordt (bijv. filteren op een subset acties), heeft Firestore
    // een COMPOSIETE index nodig die niet automatisch bestaat: dat werkt dan
    // in de emulator (die composiete indexen niet afdwingt) maar faalt in
    // productie met een "index niet gevonden"-fout. Vergeet dan niet
    // `firestore.indexes.json` bij te werken.
    const actionsQuery = query(
      this.actionsCollectionRef(organizationId, teamId, gameId),
      orderBy('sequence'),
    ).withConverter(gameActionConverter);

    const unsubParent = onSnapshot(
      gameRef,
      { includeMetadataChanges: true },
      (snapshot) => {
        // Gevonden tijdens PR 8.2a se derde-ronde focus-trap-fix (externe
        // review PR #81): een `includeMetadataChanges: true`-snapshot
        // levert BEWUST ook een tussentijdse, nog-niet-serverbevestigde
        // versie op zodra deze client zelf net geschreven heeft
        // (`hasPendingWrites: true`) — zie het commentaar hierboven bij
        // `subscribeToGame()`. Op zo'n tussentijdse snapshot staat een net
        // geschreven `serverTimestamp()`-veld nog als `null` (nog niet door
        // de server ingevuld) totdat de eerstvolgende, wél
        // serverbevestigde snapshot binnenkomt. `gameConverter.data()`
        // verwerpt dat terecht (`assertTimestamp()`) — maar die throw hier
        // ONgevangen laten ontsnappen uit een `onSnapshot()`-callback bleek
        // in de praktijk (gereproduceerd via `game-sync-takeover.spec.ts`)
        // de gedeelde Firestore-AsyncQueue van deze client blijvend te
        // vergiftigen: ELKE daaropvolgende Firestore-aanroep op deze client
        // (ook een volledig ongerelateerde `updateDoc()`/`getDoc()` in
        // `GameSyncCoordinator.sync()`) faalde daarna met exact dezelfde
        // foutmelding. Vangen en deze ene tussentijdse snapshot overslaan
        // is dus geen verlies van informatie — de eerstvolgende,
        // serverbevestigde snapshot komt vanzelf alsnog binnen — en
        // voorkomt dat een verwacht, tijdelijk conversieprobleem de hele
        // cloud-sync van dit apparaat platlegt.
        let data;
        try {
          data = snapshot.exists() ? snapshot.data() : null;
        } catch {
          return;
        }
        callbacks.onParent({
          doc: data,
          meta: {
            fromCache: snapshot.metadata.fromCache,
            hasPendingWrites: snapshot.metadata.hasPendingWrites,
          },
        });
      },
      (error) => callbacks.onError(error),
    );

    const unsubActions = onSnapshot(
      actionsQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        // Zelfde reden als `onParent` hierboven — `gameActionConverter`
        // valideert net zo streng en dezelfde tussentijdse-snapshotstaat kan
        // zich hier voordoen.
        let actions;
        try {
          actions = snapshot.docs.map((d) => d.data());
        } catch {
          return;
        }
        callbacks.onActions({
          actions,
          meta: {
            fromCache: snapshot.metadata.fromCache,
            hasPendingWrites: snapshot.metadata.hasPendingWrites,
          },
        });
      },
      (error) => callbacks.onError(error),
    );

    return () => {
      unsubParent();
      unsubActions();
    };
  }
}
