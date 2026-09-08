// PR 8.3b deel 2/2 (docs/pr-8.3-plan.md §C 8.3b werk 5/6): gedeelde
// seed-/restorehulpfuncties voor de organisatie-export-e2e-/restoreproef.
// Gebruikt uitsluitend `firebase-admin/firestore` (bypass Rules, bewust —
// zelfde precedent als `adminFixtures.ts`/`firebase/scripts/seed.ts`) om
// volledige, geconvertereerde-vorm-geldige documenten te zetten voor ALLE elf
// gegevensfamilies uit docs/pr-8.3-plan.md §A. Dit bestand is uitsluitend
// testcode — het wordt nergens vanuit `src/` geïmporteerd en komt dus nooit
// in de productiebuild terecht (plan werk 6: "test-only Admin-/
// Emulatorharness die nooit in de productiebuild komt").
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { OrganizationExportV1 } from '../../src/domain/export/types';

export interface SeededOrganization {
  orgId: string;
  teamId: string;
  ownerUid: string;
  coachUid: string;
  gameId: string;
  tombstonedCompletedGameId: string;
  activeCompletedGameId: string;
}

/**
 * Zet een volledige organisatie-/teamboom neer die alle §A-gegevensfamilies
 * raakt: organizationMembers, invitations (claimed + revoked), teams,
 * teamMembers, settings/current, roster/current, een actieve game + één
 * actie, een gewone én een getombstonede completedGame, en een migrationRun.
 * `ownerUid`/`coachUid` moeten al bestaande Auth-emulator-uid's zijn wanneer
 * de organisatie via de ECHTE UI/Rules geëxporteerd gaat worden (de eigenaar
 * moet kunnen inloggen); voor een puur Admin-side restoreproef mogen dit ook
 * losse test-uid's zijn.
 */
export async function seedFullOrganization(
  db: Firestore,
  params: {
    orgName: string;
    teamName: string;
    ownerUid: string;
    ownerEmail: string;
    coachUid: string;
    coachEmail: string;
  },
): Promise<SeededOrganization> {
  const now = Timestamp.now();
  const orgRef = db.collection('organizations').doc();
  const orgId = orgRef.id;
  await orgRef.set({ name: params.orgName, createdBy: params.ownerUid, createdAt: now });

  await orgRef.collection('organizationMembers').doc(params.ownerUid).set({
    role: 'organizationOwner',
    email: params.ownerEmail,
    uid: params.ownerUid,
    joinedAt: now,
  });

  await orgRef.collection('invitations').doc().set({
    email: 'geclaimd@example.test',
    role: 'coach',
    status: 'claimed',
    invitedBy: params.ownerUid,
    invitedAt: now,
    acceptedAt: now,
    claimedAt: now,
  });
  await orgRef.collection('invitations').doc().set({
    email: 'ingetrokken@example.test',
    role: 'viewer',
    status: 'revoked',
    invitedBy: params.ownerUid,
    invitedAt: now,
    acceptedAt: null,
  });

  const teamRef = orgRef.collection('teams').doc();
  const teamId = teamRef.id;
  await teamRef.set({
    name: params.teamName,
    orgName: params.orgName,
    createdBy: params.ownerUid,
    createdAt: now,
  });

  await teamRef
    .collection('teamMembers')
    .doc(params.coachUid)
    .set({ role: 'coach', email: params.coachEmail, uid: params.coachUid, addedAt: now });

  await teamRef.collection('settings').doc('current').set({
    teamName: params.teamName,
    logoUri: '',
    primaryColor: '#123456',
    accentColor: '#654321',
    quarterCount: 4,
    periodLabel: 'Kwart',
    useClassLimit: false,
    tag1Label: 'Vrouw',
    tag2Label: 'Jeugd',
    classBaseLimit: 14,
    maxBonus: 2,
    bonusTag1Only: 1,
    bonusTag2Only: 1,
    bonusBoth: 2,
    updatedAt: now,
  });

  await teamRef
    .collection('roster')
    .doc('current')
    .set({
      players: [{ id: 1, nr: '4', naam: 'Speler Een', kl: '3.0', vrouw: false, jeugd: false }],
      updatedAt: now,
    });

  const nowIso = new Date().toISOString();
  const player = {
    id: 'p1',
    rosterId: 1,
    nr: '4',
    naam: 'Speler Een',
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  };

  const gameRef = teamRef.collection('games').doc();
  const gameId = gameRef.id;
  await gameRef.set({
    organizationId: orgId,
    teamId,
    phase: 'setup',
    players: [player],
    opponent: 'Tegenstander',
    competition: 'Competitie',
    clockDown: true,
    limitStr: '',
    onCourt: [],
    curQuarter: 1,
    beginSec: 0,
    endSec: 600,
    pendingSwapLineup: null,
    scoreFor: 0,
    scoreAgainst: 0,
    segmentCount: 0,
    writerUid: params.ownerUid,
    deviceId: 'device-seed',
    writerEpoch: 0,
    claimedAt: nowIso,
    lastWriterActivityAt: nowIso,
    revision: 0,
    createdAt: nowIso,
    startedAt: null,
    completedGameId: null,
    updatedAt: now,
  });
  // `gameActionConverter.fromFirestore()` eist dat het `actionId`-VELD exact
  // gelijk is aan de echte documentnaam (`assertPathContextField`) — een
  // losse `.doc()` met een hardcoded `actionId`-veld faalt die check zodra
  // de export dit document via de ECHTE converter/Rules terugleest (in
  // tegenstelling tot een kale Admin-`set()`, die niets valideert). Maak
  // daarom eerst de doc-ref aan en gebruik zijn eigen gegenereerde ID.
  const actionRef = gameRef.collection('actions').doc();
  await actionRef.set({
    organizationId: orgId,
    teamId,
    gameId,
    actionId: actionRef.id,
    authorUid: params.ownerUid,
    deviceId: 'device-seed',
    writerEpoch: 0,
    sequence: 0,
    occurredAt: nowIso,
    schemaVersion: 1,
    action: { type: 'score-delta', team: 'for', delta: 2 },
  });

  const activeCompletedGameRef = teamRef.collection('completedGames').doc();
  const activeCompletedGameId = activeCompletedGameRef.id;
  await activeCompletedGameRef.set({
    organizationId: orgId,
    teamId,
    sourceGameId: 'source-game-active',
    opponent: 'Actief-Tegenstander',
    competition: 'Competitie',
    date: '2026-01-01',
    players: [player],
    segments: [],
    scoreFor: 10,
    scoreAgainst: 8,
    quarterCount: 4,
    periodLabel: 'Kwart',
    useClassLimit: false,
    syncedAt: now,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  });

  const tombstonedCompletedGameRef = teamRef.collection('completedGames').doc();
  const tombstonedCompletedGameId = tombstonedCompletedGameRef.id;
  await tombstonedCompletedGameRef.set({
    organizationId: orgId,
    teamId,
    sourceGameId: 'source-game-tombstoned',
    opponent: 'Getombstoned-Tegenstander',
    competition: 'Competitie',
    date: '2026-01-02',
    players: [player],
    segments: [],
    scoreFor: 5,
    scoreAgainst: 20,
    quarterCount: 4,
    periodLabel: 'Kwart',
    useClassLimit: false,
    syncedAt: now,
    revision: 1,
    deletedAt: now,
    deletedBy: params.ownerUid,
  });

  await teamRef.collection('migrationRuns').doc().set({
    status: 'completed',
    manifestHash: 'seed-manifest-hash',
    updatedAt: now,
  });

  return {
    orgId,
    teamId,
    ownerUid: params.ownerUid,
    coachUid: params.coachUid,
    gameId,
    tombstonedCompletedGameId,
    activeCompletedGameId,
  };
}

/**
 * Test-only "restore": herschrijft een reeds gebouwde en geverifieerde
 * `OrganizationExportV1` naar een GEHEEL NIEUWE, geïsoleerde organisatie
 * (plan werk 6: "nieuwe fictieve Emulator-doelcontext"). Elke rij levert
 * exact de velden die de export droeg terug (`id` wordt de documentnaam,
 * de rest wordt 1:1 teruggeschreven) — dit is bewust GEEN algemene
 * organisatie-importknop en bestaat uitsluitend in testcode, nooit in
 * `src/`. `ownerUid` wordt de nieuwe organisatie-eigenaar zodat een tweede
 * account de herstelde inhoud via de ECHTE Rules/gateway kan terugleveren.
 */
export async function restoreOrganizationExportIntoNewOrg(
  db: Firestore,
  data: OrganizationExportV1,
  ownerUid: string,
): Promise<string> {
  const orgRef = db.collection('organizations').doc();
  const orgId = orgRef.id;
  await orgRef.set({
    name: data.organization.name,
    createdBy: data.organization.createdBy,
    createdAt: Timestamp.fromDate(new Date(data.organization.createdAt)),
  });

  // De export-eigenaar (`data.organization.createdBy`) wordt bij restore
  // vervangen door de NIEUWE, echte inlogbare `ownerUid` — dat is de enige
  // identiteitssubstitutie die deze restore doet (plan werk 6 vereist een
  // tweede, eigen eigenaarsaccount om de doelcontext via de Rules te kunnen
  // teruglezen). Alle ANDERE `organizationMembers`-rijen worden 1:1
  // teruggeschreven, zodat het AANTAL leden — en dus de canonieke
  // inventaris — ongewijzigd blijft t.o.v. de bron (geen extra rij).
  for (const member of data.organizationMembers) {
    const { id, uid, joinedAt, ...rest } = member as Record<string, unknown> & {
      id: string;
      uid: string;
    };
    const isOriginalOwner = id === data.organization.createdBy;
    const docId = isOriginalOwner ? ownerUid : id;
    await orgRef
      .collection('organizationMembers')
      .doc(docId)
      .set({
        ...rest,
        uid: isOriginalOwner ? ownerUid : uid,
        ...(joinedAt ? { joinedAt: Timestamp.fromDate(new Date(joinedAt as string)) } : {}),
      });
  }

  for (const invitation of data.invitations) {
    const { id, invitedAt, acceptedAt, claimedAt, ...rest } = invitation as Record<
      string,
      unknown
    > & {
      id: string;
    };
    await orgRef
      .collection('invitations')
      .doc(id)
      .set({
        ...rest,
        invitedAt: Timestamp.fromDate(new Date(invitedAt as string)),
        acceptedAt: acceptedAt ? Timestamp.fromDate(new Date(acceptedAt as string)) : null,
        ...(claimedAt ? { claimedAt: Timestamp.fromDate(new Date(claimedAt as string)) } : {}),
      });
  }

  for (const team of data.teams) {
    const teamRef = orgRef.collection('teams').doc(team.teamId);
    await teamRef.set({
      name: team.name,
      orgName: data.organization.name,
      createdBy: team.createdBy,
      createdAt: Timestamp.fromDate(new Date(team.createdAt)),
    });

    for (const member of team.teamMembers) {
      const { id, addedAt, ...rest } = member as Record<string, unknown> & { id: string };
      await teamRef
        .collection('teamMembers')
        .doc(id)
        .set({
          ...rest,
          ...(addedAt ? { addedAt: Timestamp.fromDate(new Date(addedAt as string)) } : {}),
        });
    }

    if (team.settings) {
      const { id, updatedAt, ...rest } = team.settings as Record<string, unknown> & { id: string };
      void id;
      await teamRef
        .collection('settings')
        .doc('current')
        .set({ ...rest, updatedAt: Timestamp.fromDate(new Date(updatedAt as string)) });
    }

    if (team.roster) {
      const { id, updatedAt, ...rest } = team.roster as Record<string, unknown> & { id: string };
      void id;
      await teamRef
        .collection('roster')
        .doc('current')
        .set({ ...rest, updatedAt: Timestamp.fromDate(new Date(updatedAt as string)) });
    }

    // `gameConverter`/`gameActionConverter`/`completedGameConverter` eisen dat
    // het `organizationId`-VELD exact gelijk is aan het echte pad-segment
    // (`assertPathContextField`) — bij restore is dat de NIEUWE `orgId`, niet
    // de gekopieerde brondata-waarde. `teamId`/`gameId`/`actionId` blijven wel
    // 1:1 de brondata-waarde: hun documenten worden bewust onder DEZELFDE
    // ID's teruggeschreven, dus die velden matchen het pad ook zonder
    // substitutie.
    for (const game of team.games) {
      const { id, actions, updatedAt, ...rest } = game as Record<string, unknown> & {
        id: string;
        actions: Record<string, unknown>[];
      };
      const gameRef = teamRef.collection('games').doc(id);
      await gameRef.set({
        ...rest,
        organizationId: orgId,
        updatedAt: Timestamp.fromDate(new Date(updatedAt as string)),
      });
      for (const action of actions) {
        const { id: actionId, ...actionRest } = action as Record<string, unknown> & { id: string };
        await gameRef
          .collection('actions')
          .doc(actionId)
          .set({ ...actionRest, organizationId: orgId });
      }
    }

    for (const completedGame of team.completedGames) {
      const { id, syncedAt, deletedAt, ...rest } = completedGame as Record<string, unknown> & {
        id: string;
      };
      await teamRef
        .collection('completedGames')
        .doc(id)
        .set({
          ...rest,
          organizationId: orgId,
          syncedAt: Timestamp.fromDate(new Date(syncedAt as string)),
          deletedAt: deletedAt ? Timestamp.fromDate(new Date(deletedAt as string)) : null,
        });
    }

    for (const run of team.migrationRuns) {
      const { id, updatedAt, ...rest } = run as Record<string, unknown> & { id: string };
      await teamRef
        .collection('migrationRuns')
        .doc(id)
        .set({
          ...rest,
          ...(updatedAt ? { updatedAt: Timestamp.fromDate(new Date(updatedAt as string)) } : {}),
        });
    }
  }

  return orgId;
}

/**
 * Vergelijkbare, identiteitsonafhankelijke projectie van een export — plan
 * werk 6 "vergelijk canonieke inventaris" vergelijkt INHOUD, niet de
 * doelorganisatie-identiteit zelf (die verschilt bewust: de restoreproef
 * schrijft naar een NIEUWE organisatie-ID, nooit terug over de bron). Laat
 * daarom `exportedAt`/`exportedBy`/`contentHash` en de org-ID-velden weg. De
 * `organizationMembers`-eigenaarsrij draagt daarnaast bewust een NIEUWE
 * `id`/`uid` na restore (zie `restoreOrganizationExportIntoNewOrg()`'s
 * eigenaarssubstitutie hierboven) — die twee velden worden per rij
 * weggelaten, de rol/e-mail/`joinedAt`-inhoud blijft wél vergeleken.
 */
export function normalizeExportForComparison(data: OrganizationExportV1): Omit<
  OrganizationExportV1,
  | 'exportedAt'
  | 'exportedBy'
  | 'contentHash'
  | 'sourceContext'
  | 'organization'
  | 'organizationMembers'
> & {
  organization: Omit<OrganizationExportV1['organization'], 'id'>;
  organizationMembers: Omit<OrganizationExportV1['organizationMembers'][number], 'id' | 'uid'>[];
} {
  const {
    exportedAt,
    exportedBy,
    contentHash,
    sourceContext,
    organization,
    organizationMembers,
    ...rest
  } = data;
  void exportedAt;
  void exportedBy;
  void contentHash;
  void sourceContext;
  const { id, ...organizationRest } = organization;
  void id;
  const normalizedMembers = organizationMembers
    .map((member) => {
      const {
        id: memberId,
        uid,
        ...memberRest
      } = member as Record<string, unknown> & {
        id: string;
        uid: string;
      };
      void memberId;
      void uid;
      return memberRest;
    })
    .sort((a, b) => String(a.email).localeCompare(String(b.email)));
  return {
    ...(stripOrganizationIdDeep(rest) as typeof rest),
    organization: organizationRest,
    organizationMembers: normalizedMembers,
  };
}

/**
 * `games`/`actions`/`completedGames`-rijen dragen elk hun eigen
 * `organizationId`-veld (nodig voor `assertPathContextField()` op de
 * ECHTE doelorganisatie na restore, zie `restoreOrganizationExportIntoNewOrg()`
 * hierboven) — dat veld draagt bewust de NIEUWE org-ID en verschilt dus
 * altijd van de bron. Recursief verwijderen zodat de rest van elke rij
 * (scores, spelers, segmenten, tijden, …) wél letterlijk vergeleken wordt.
 */
function stripOrganizationIdDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripOrganizationIdDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'organizationId') continue;
      out[key] = stripOrganizationIdDeep(v);
    }
    return out;
  }
  return value;
}
