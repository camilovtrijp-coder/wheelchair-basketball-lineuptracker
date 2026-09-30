// PR 8.3c-1d — gemeten proefuitvoering van het verwijderrunbook (docs/pr-8.3c-runbook.md)
// op een FICTIEVE organisatie in de Firestore-emulator. Draait de alleen-lezen inventaris
// (dezelfde library als `npm run runbook:inventory`) en bewijst het runbookverloop:
// vooraf-inventaris → dump met stabiele hash → status `executing` → wissen → readback nul
// → uitvoeringsrecord zonder persoonsgegevens, met een tweede organisatie die onaangeroerd
// blijft. Stap 4 (wissen) gebruikt hier `recursiveDelete` van firebase-admin als
// emulator-vervanger: `firebase firestore:delete -r` vereist ook tegen de emulator een
// ingelogde CLI-sessie (zonder login faalt het in `requireAuth`; vastgesteld tijdens 1d) en
// is dus niet in CI uitvoerbaar. Dat commando zelf wordt op de uitvoeringsdatum na
// `firebase login` tegen de emulator en daarna tegen een fictieve staging-organisatie
// geverifieerd (runbook §6).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertEmulatorEnv } from '../../scripts/assertEmulatorEnv.js';
import { buildExecutionRecord } from '../../scripts/lib/executionRecord.js';
import {
  canonicalDump,
  dumpDocuments,
  hashDump,
  inventoryOrganization,
  isOrganizationEmpty,
} from '../../scripts/lib/orgInventory.js';

assertEmulatorEnv();

const PROJECT_ID = 'demo-lineup-tracker-dev';
const ORG = 'drill-org-a';
const OTHER_ORG = 'drill-org-b';
const DAY = 24 * 60 * 60 * 1000;

let db: Firestore;
let workDir: string;
const timings: Record<string, number> = {};

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await run();
  } finally {
    timings[label] = Math.round(performance.now() - start);
  }
}

async function seedOrganization(orgId: string, withPhantom: boolean): Promise<void> {
  const now = Timestamp.now();
  const org = db.collection('organizations').doc(orgId);
  await org.set({
    name: `Fictieve club ${orgId}`,
    createdBy: 'uid-owner',
    createdAt: now,
  });
  await org.collection('organizationMembers').doc('uid-owner').set({
    role: 'organizationOwner',
    email: 'owner@example.test',
    uid: 'uid-owner',
    joinedAt: now,
  });
  await org.collection('organizationMembers').doc('uid-admin').set({
    role: 'organizationAdmin',
    email: 'admin@example.test',
    uid: 'uid-admin',
    joinedAt: now,
  });
  await org
    .collection('invitations')
    .doc('inv-1')
    .set({ email: 'nieuw@example.test', status: 'pending', invitedAt: now });
  for (const teamId of ['team-1', 'team-2']) {
    const team = org.collection('teams').doc(teamId);
    await team.set({
      name: `Team ${teamId}`,
      createdBy: 'uid-owner',
      createdAt: now,
    });
    await team
      .collection('teamMembers')
      .doc('uid-owner')
      .set({ role: 'coach', email: 'owner@example.test', uid: 'uid-owner' });
    await team.collection('settings').doc('current').set({ teamName: 'Fictief', updatedAt: now });
    await team
      .collection('roster')
      .doc('current')
      .set({
        players: [
          { id: 'p1', name: 'Speler Een', number: 4 },
          { id: 'p2', name: 'Speler Twee', number: 5 },
        ],
        updatedAt: now,
      });
    const game = team.collection('games').doc('game-1');
    await game.set({ opponent: 'Fictief Tegen', updatedAt: now });
    await game.collection('actions').doc('a1').set({ type: 'score', at: now });
    await game.collection('actions').doc('a2').set({ type: 'score', at: now });
    await team.collection('completedGames').doc('cg-1').set({ opponent: 'Oud', deletedAt: null });
    await team.collection('migrationRuns').doc('run-1').set({ status: 'completed' });
  }
  await org
    .collection('deletionRequests')
    .doc('current')
    .set({
      organizationId: orgId,
      status: 'requested',
      attempt: 1,
      revision: 0,
      requestedBy: 'uid-owner',
      requestedAt: Timestamp.fromMillis(Date.now() - 8 * DAY),
      exportProof: {
        contentHash: 'sha256:fictief',
        exportedAt: new Date(Date.now() - 8 * DAY).toISOString(),
        counts: EXPECTED_COUNTS,
      },
      cancelledAt: null,
    });
  if (withPhantom) {
    // Geen document `teams/phantom` zelf, wel een wedstrijd eronder: een wees die een
    // collectie-`get()` zou overslaan en die het runbook dus niet mag laten staan.
    await org
      .collection('teams')
      .doc('phantom')
      .collection('games')
      .doc('orphan')
      .set({ opponent: 'Wees' });
  }
}

const EXPECTED_COUNTS = {
  organizationMembers: 2,
  invitations: 1,
  teams: 2,
  teamMembers: 2,
  settingsDocuments: 2,
  rosterPlayers: 4,
  games: 2,
  gameActions: 4,
  completedGames: 2,
  migrationRuns: 2,
};

describe('deletion runbook drill (PR 8.3c-1d)', () => {
  beforeAll(async () => {
    if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
    db = getFirestore();
    workDir = mkdtempSync(path.join(tmpdir(), 'runbook-drill-'));
    await db.recursiveDelete(db.collection('organizations').doc(ORG));
    await db.recursiveDelete(db.collection('organizations').doc(OTHER_ORG));
    await seedOrganization(ORG, true);
    await seedOrganization(OTHER_ORG, false);
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
    console.log(`runbook-drill timings (ms, emulator): ${JSON.stringify(timings)}`);
  });

  it('volledige proefuitvoering: inventaris, dump, executing, wissen, readback nul, record', async () => {
    // 1. Vooraf-inventaris met met de hand na te rekenen aantallen.
    const before = await timed('1-inventaris', () => inventoryOrganization(db, ORG));
    expect(before.organizationExists).toBe(true);
    // De wees telt als wedstrijd (3) maar niet als team (2).
    expect(before.counts).toEqual({ ...EXPECTED_COUNTS, games: 3 });
    expect(before.deletionRequests).toBe(1);
    expect(before.unmapped).toEqual({});
    // Organisatiedoc + 2 leden + 1 uitnodiging + 2 teams x (teamdoc, teamlid, settings, roster,
    // game, 2 acties, completedGame, run = 9) + 1 verzoek + 1 wees = 1+2+1+18+1+1 = 24.
    expect(before.totalDocuments).toBe(24);
    expect(before.documents.some((doc) => doc.path === 'teams/phantom/games/orphan')).toBe(true);
    expect(before.documents.some((doc) => doc.path === 'teams/phantom')).toBe(false);

    // 2. Dump met stabiele hash (beheerdersdump, uitvoerpad buiten de repo).
    const dumpFile = path.join(workDir, 'dump.json');
    const dump = await timed('2-dump', async () => canonicalDump(dumpDocuments(before)));
    writeFileSync(dumpFile, dump, { mode: 0o600 });
    const contentHash = hashDump(dump);
    const again = await inventoryOrganization(db, ORG);
    expect(hashDump(canonicalDump(dumpDocuments(again)))).toBe(contentHash);
    expect(readFileSync(dumpFile, 'utf8')).toContain('Speler Een'); // de dump bevat wél PII

    // 3. Status `executing` door de beheerder (Admin-rechten; een client mag dit nooit).
    const request = db.doc(`organizations/${ORG}/deletionRequests/current`);
    const requested = (await request.get()).data() as {
      requestedAt: Timestamp;
      requestedBy: string;
    };
    await timed('3-executing', () => request.update({ status: 'executing', revision: 1 }));
    expect(((await request.get()).data() as { status: string }).status).toBe('executing');
    // Stap 5 wijzigt het verzoekdocument, maar de hash van stap 6 blijft gelijk: het verzoek
    // zit niet in de dump. Een nieuwe schrijfactie elders verandert hem wel.
    const beforeDelete = await inventoryOrganization(db, ORG);
    expect(hashDump(canonicalDump(dumpDocuments(beforeDelete)))).toBe(contentHash);
    expect(
      dumpDocuments(beforeDelete).some((doc) => doc.path.startsWith('deletionRequests/')),
    ).toBe(false);

    // 4. Wissen (emulator-vervanger van `firebase firestore:delete -r`).
    await timed('4-wissen', () => db.recursiveDelete(db.collection('organizations').doc(ORG)));

    // 5. Readback: alles nul, ook het organisatiedocument; de andere organisatie is intact.
    const after = await timed('5-readback', () => inventoryOrganization(db, ORG));
    expect(isOrganizationEmpty(after)).toBe(true);
    expect(after.counts).toEqual({
      organizationMembers: 0,
      invitations: 0,
      teams: 0,
      teamMembers: 0,
      settingsDocuments: 0,
      rosterPlayers: 0,
      games: 0,
      gameActions: 0,
      completedGames: 0,
      migrationRuns: 0,
    });
    const other = await inventoryOrganization(db, OTHER_ORG);
    expect(other.counts).toEqual(EXPECTED_COUNTS);
    expect(other.totalDocuments).toBe(23);

    // 6. Uitvoeringsrecord buiten Firestore: alleen de zes velden, geen PII.
    const record = buildExecutionRecord({
      organizationId: ORG,
      requestedAt: requested.requestedAt.toDate().toISOString(),
      requestedBy: requested.requestedBy,
      executedAt: new Date().toISOString(),
      counts: before.counts,
      contentHash,
    });
    const recordJson = JSON.stringify(record);
    expect(recordJson).not.toContain('@');
    expect(recordJson).not.toContain('Speler');
    expect(Object.keys(record).sort()).toEqual(
      [
        'contentHash',
        'counts',
        'executedAt',
        'organizationId',
        'requestedAt',
        'requestedBy',
      ].sort(),
    );
  });

  it('de readback ziet een half uitgevoerde wissing (resterende wees) als niet leeg', async () => {
    const partial = 'drill-org-partial';
    const org = db.collection('organizations').doc(partial);
    await org.collection('teams').doc('ghost').collection('games').doc('g').set({ a: 1 });
    const inventory = await inventoryOrganization(db, partial);
    expect(inventory.organizationExists).toBe(false);
    expect(inventory.totalDocuments).toBe(1);
    expect(isOrganizationEmpty(inventory)).toBe(false);
    await db.recursiveDelete(org);
    expect(isOrganizationEmpty(await inventoryOrganization(db, partial))).toBe(true);
  });

  it('een onbekende gegevensfamilie valt niet stil buiten de telling', async () => {
    const odd = 'drill-org-odd';
    const org = db.collection('organizations').doc(odd);
    await org.set({ name: 'x' });
    await org.collection('nieuweFamilie').doc('n1').set({ a: 1 });
    const inventory = await inventoryOrganization(db, odd);
    expect(inventory.unmapped).toEqual({ nieuweFamilie: 1 });
    expect(isOrganizationEmpty(inventory)).toBe(false);
    await db.recursiveDelete(org);
  });
});
