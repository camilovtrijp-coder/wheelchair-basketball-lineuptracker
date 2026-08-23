// Firestore-implementatie van CloudMigrationInventoryGateway (PR 7.4a,
// docs/pr-7.4-plan.md §C 7.4a). Leest UITSLUITEND — geen enkele write in dit
// bestand (werk 2: "benodigde writes" is in 7.4a alleen een GERAPPORTEERDE
// TELLING, de daadwerkelijke schrijfcoordinator is 7.4b-scope). Elke
// Firestore-aanroep hier is aan een timeout gebonden (`withTimeout`, zelfde
// patroon/reden als `FirestoreGameCloudGateway.ts` — een hangende offline
// getDoc()/getDocs() mag de preview nooit onbeperkt laten hangen).
//
// Rules-toegang: `canReadTeam` staat settings/roster/games/completedGames-
// lezen al vóór PR 7.4a voor elke teamrol toe (zie firestore.rules punten
// 605/627/633/639/831 en PR 7.3b's precedent-redenering) — geen nieuwe
// Rules nodig.
import { collection, doc, getDoc, getDocs, query, where, type Firestore } from 'firebase/firestore';
import {
  completedGameConverter,
  gameConverter,
  rosterConverter,
  settingsConverter,
} from 'firebase-base/documents';
import type { CloudMigrationInventoryGateway } from '../../application/migration/CloudMigrationInventoryGateway';
import type { CloudExistingSnapshot } from '../../domain/migration/types';
import {
  activeGameCloudPayloadHash,
  completedGamePayloadHash,
  rosterPayloadHash,
  settingsPayloadHash,
} from '../../domain/migration/payload';
import { completedGameFromDocument } from '../game/FirestoreCompletedGameRepository';
import type { Roster } from '../../domain/roster/types';

const DEFAULT_TIMEOUT_MS = 8000;

class CloudMigrationInventoryTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label}: geen serverantwoord binnen ${ms}ms`);
    this.name = 'CloudMigrationInventoryTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CloudMigrationInventoryTimeoutError(label, ms)), ms);
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
 * Firestore's `in`-operator staat max. 30 waarden toe per query (huidige
 * SDK-limiet) — begrensd, gebatchte `documentId() in [...]`-lookups i.p.v.
 * één ongelimiteerde query, zodat een team met veel afgeronde wedstrijden de
 * preview niet op een enkele te-grote query laat stuklopen. Puur een
 * defensieve leesgrens, spiegelt `COMPLETED_GAMES_QUERY_LIMIT`'s bedoeling
 * (`FirestoreCompletedGameRepository.ts`) zonder dat exacte getal te
 * hergebruiken (dat is een PAGINAgrootte voor de hele collectie, dit is een
 * per-`in`-query-batchgrootte voor specifiek bekende ID's).
 */
const FIRESTORE_IN_QUERY_BATCH_SIZE = 30;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class FirestoreCloudMigrationInventoryGateway implements CloudMigrationInventoryGateway {
  constructor(
    private readonly db: Firestore,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async readTargetSnapshot(
    organizationId: string,
    teamId: string,
    completedGameIds: readonly string[],
    activeGameId: string | null,
  ): Promise<CloudExistingSnapshot> {
    const [settings, roster, completedGames, activeGame] = await Promise.all([
      this.readSettings(organizationId, teamId),
      this.readRoster(organizationId, teamId),
      this.readCompletedGames(organizationId, teamId, completedGameIds),
      this.readActiveGame(organizationId, teamId, activeGameId),
    ]);
    return { settings, roster, completedGames, activeGame };
  }

  private teamPath(organizationId: string, teamId: string): [string, ...string[]] {
    return ['organizations', organizationId, 'teams', teamId];
  }

  private async readSettings(
    organizationId: string,
    teamId: string,
  ): Promise<CloudExistingSnapshot['settings']> {
    const ref = doc(
      this.db,
      ...this.teamPath(organizationId, teamId),
      'settings',
      'current',
    ).withConverter(settingsConverter);
    const snap = await withTimeout(getDoc(ref), this.timeoutMs, 'readTargetSnapshot:settings');
    if (!snap.exists()) return { present: false, hash: null };
    const { updatedAt: _updatedAt, ...rest } = snap.data();
    void _updatedAt;
    return { present: true, hash: settingsPayloadHash(rest) };
  }

  private async readRoster(
    organizationId: string,
    teamId: string,
  ): Promise<CloudExistingSnapshot['roster']> {
    const ref = doc(
      this.db,
      ...this.teamPath(organizationId, teamId),
      'roster',
      'current',
    ).withConverter(rosterConverter);
    const snap = await withTimeout(getDoc(ref), this.timeoutMs, 'readTargetSnapshot:roster');
    if (!snap.exists()) return { present: false, hash: null };
    // RosterPlayerDocument draagt exact `Player`'s bekende velden (geen
    // onbekende extra velden zoals `RosterPlayer`'s lokale `Record<string,
    // unknown>`-restcategorie toestaat) — een structureel compatibele
    // deelverzameling, dus veilig als `Roster` te hashen.
    return { present: true, hash: rosterPayloadHash(snap.data().players as unknown as Roster) };
  }

  private async readCompletedGames(
    organizationId: string,
    teamId: string,
    ids: readonly string[],
  ): Promise<CloudExistingSnapshot['completedGames']> {
    const map = new Map<string, { hash: string }>();
    if (ids.length === 0) return map;
    const collectionRef = collection(
      this.db,
      ...this.teamPath(organizationId, teamId),
      'completedGames',
    ).withConverter(completedGameConverter);
    for (const batch of chunk(ids, FIRESTORE_IN_QUERY_BATCH_SIZE)) {
      // Firestore's document-ID-veld heet '__name__'; `where('__name__', 'in', ...)`
      // is de gedocumenteerde manier om op een bekende ID-set te filteren
      // zonder N losse getDoc()-aanroepen.
      const q = query(collectionRef, where('__name__', 'in', batch));
      const snap = await withTimeout(
        getDocs(q),
        this.timeoutMs,
        'readTargetSnapshot:completedGames',
      );
      for (const d of snap.docs) {
        const game = completedGameFromDocument(d.id, d.data());
        map.set(d.id, { hash: completedGamePayloadHash(game) });
      }
    }
    return map;
  }

  private async readActiveGame(
    organizationId: string,
    teamId: string,
    activeGameId: string | null,
  ): Promise<CloudExistingSnapshot['activeGame']> {
    if (activeGameId === null) return { present: false, hash: null, phase: null };
    const ref = doc(
      this.db,
      ...this.teamPath(organizationId, teamId),
      'games',
      activeGameId,
    ).withConverter(gameConverter);
    const snap = await withTimeout(getDoc(ref), this.timeoutMs, 'readTargetSnapshot:activeGame');
    if (!snap.exists()) return { present: false, hash: null, phase: null };
    const data = snap.data();
    return {
      present: true,
      hash: activeGameCloudPayloadHash(data),
      phase: data.phase,
    };
  }
}
