// PR 8.3c-1d (docs/pr-8.3c-runbook.md): alleen-lezen inventaris van één organisatie voor
// het handmatige verwijderrunbook. Werkt op ELKE firebase-admin-Firestore (emulator of
// echt project met Application Default Credentials — nooit een sleutelbestand) en wijzigt
// nooit iets. Loopt generiek door de hele deelboom van `organizations/{orgId}`, zodat een
// gegevensfamilie die later bijkomt niet stil buiten de telling valt; aantallen worden per
// patroon (ids vervangen door `*`) bijgehouden en gemapt op dezelfde tien sleutels als
// `exportProof.counts` (`DELETION_REQUEST_COUNT_KEYS`).
//
// Let op: `contentHash` hier is de hash van de beheerdersdump (canonieke JSON van alle
// documenten, gesorteerd op pad) en NIET die van de 8.3b-exportenvelop — het runbook
// gebruikt hem als bewijs van wat er vlak vóór het wissen stond, niet om met het
// `exportProof` van de eigenaar te vergelijken.
import { createHash } from 'node:crypto';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { DELETION_REQUEST_COUNT_KEYS } from '../../src/documents/deletionRequest.js';
import type { DeletionRequestExportCounts } from '../../src/documents/deletionRequest.js';

export interface OrgDocument {
  /** Pad relatief aan het organisatiedocument, bv. `teams/t1/games/g1`. */
  path: string;
  data: unknown;
}

export interface OrgInventory {
  organizationId: string;
  /** Bestaat het organisatiedocument zelf nog? */
  organizationExists: boolean;
  /** Aantal bestaande documenten (inclusief het organisatiedocument zelf). */
  totalDocuments: number;
  counts: DeletionRequestExportCounts;
  /** Aantal `deletionRequests`-documenten; hoort niet bij `exportProof.counts`. */
  deletionRequests: number;
  /** Documentpatronen die op geen van de tien sleutels mappen; nooit stil negeren. */
  unmapped: Record<string, number>;
  documents: OrgDocument[];
}

const PATTERN_TO_KEY: Record<string, keyof DeletionRequestExportCounts | 'deletionRequests'> = {
  organizationMembers: 'organizationMembers',
  invitations: 'invitations',
  teams: 'teams',
  'teams/*/teamMembers': 'teamMembers',
  'teams/*/settings': 'settingsDocuments',
  'teams/*/roster': 'rosterPlayers',
  'teams/*/games': 'games',
  'teams/*/games/*/actions': 'gameActions',
  'teams/*/completedGames': 'completedGames',
  'teams/*/migrationRuns': 'migrationRuns',
  deletionRequests: 'deletionRequests',
};

function emptyCounts(): DeletionRequestExportCounts {
  return Object.fromEntries(
    DELETION_REQUEST_COUNT_KEYS.map((key) => [key, 0]),
  ) as DeletionRequestExportCounts;
}

function toPattern(path: string): string {
  // Een documentpad heeft een even aantal segmenten: collectienaam op de even indexen
  // (0, 2, 4…), documentid op de oneven. Het patroon is het collectiepad met ids als `*`,
  // zonder het id van het document zelf.
  const segments = path.split('/');
  return segments
    .slice(0, -1)
    .map((segment, index) => (index % 2 === 0 ? segment : '*'))
    .join('/');
}

/** Firestore `Timestamp` → `{ __timestamp: ISO }`; andere waarden blijven onaangeroerd. */
function jsonSafe(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    return {
      __timestamp: (value as { toDate(): Date }).toDate().toISOString(),
    };
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => [key, jsonSafe(inner)]),
  );
}

/** Canonieke JSON van de documenten, gesorteerd op pad: stabiel voor dezelfde inhoud. */
export function canonicalDump(documents: OrgDocument[]): string {
  const sorted = [...documents].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return JSON.stringify(sorted.map((entry) => ({ path: entry.path, data: jsonSafe(entry.data) })));
}

export function hashDump(dump: string): string {
  return `sha256:${createHash('sha256').update(dump).digest('hex')}`;
}

/**
 * Aantal kinderen per collectie dat tegelijk wordt uitgelezen. Dit geldt per niveau en
 * vermenigvuldigt dus bij diepe geneste structuren; het begrenst niet het totaal.
 */
const WALK_CONCURRENCY = 25;

async function walk(
  ref: DocumentReference,
  relativePath: string,
  out: OrgDocument[],
): Promise<void> {
  const [snapshot, collections] = await Promise.all([ref.get(), ref.listCollections()]);
  if (snapshot.exists) out.push({ path: relativePath, data: snapshot.data() });
  for (const collection of collections) {
    // `listDocuments()` geeft ook documenten zonder eigen velden terug die alleen nog
    // subcollecties hebben; `get()` op de collectie zou die overslaan en ze dus laten staan.
    const children = await collection.listDocuments();
    for (let index = 0; index < children.length; index += WALK_CONCURRENCY) {
      await Promise.all(
        children
          .slice(index, index + WALK_CONCURRENCY)
          .map((child) =>
            walk(child, `${relativePath}/${collection.id}/${child.id}`.replace(/^\//, ''), out),
          ),
      );
    }
  }
}

export async function inventoryOrganization(
  db: Firestore,
  organizationId: string,
): Promise<OrgInventory> {
  const orgRef = db.collection('organizations').doc(organizationId);
  const collected: OrgDocument[] = [];
  await walk(orgRef, '', collected);

  const counts = emptyCounts();
  const unmapped: Record<string, number> = {};
  let deletionRequests = 0;
  let organizationExists = false;
  for (const entry of collected) {
    if (entry.path === '') {
      organizationExists = true;
      continue;
    }
    const pattern = toPattern(entry.path);
    const key = PATTERN_TO_KEY[pattern];
    if (key === undefined) {
      unmapped[pattern] = (unmapped[pattern] ?? 0) + 1;
    } else if (key === 'deletionRequests') {
      deletionRequests += 1;
    } else if (key === 'rosterPlayers') {
      const players = (entry.data as { players?: unknown }).players;
      counts.rosterPlayers += Array.isArray(players) ? players.length : 0;
    } else {
      counts[key] += 1;
    }
  }

  return {
    organizationId,
    organizationExists,
    totalDocuments: collected.length,
    counts,
    deletionRequests,
    unmapped,
    documents: collected.map((entry) => ({
      ...entry,
      path: entry.path || '.',
    })),
  };
}

/**
 * De documenten die in de dump en de hash horen: alles behalve `deletionRequests/*`. Dat
 * document is boekhouding van het runbook zelf (stap 5 wijzigt `status` en `revision`) en
 * zou elke herhaalde hashvergelijking laten afwijken. De aanvraag staat wel in de telling
 * (`deletionRequests`) en in het logboek.
 */
export function dumpDocuments(inventory: OrgInventory): OrgDocument[] {
  return inventory.documents.filter((entry) => !entry.path.startsWith('deletionRequests/'));
}

/** Het eindoordeel van de readback: alles moet nul zijn, ook het organisatiedocument. */
export function isOrganizationEmpty(inventory: OrgInventory): boolean {
  return inventory.totalDocuments === 0 && !inventory.organizationExists;
}
