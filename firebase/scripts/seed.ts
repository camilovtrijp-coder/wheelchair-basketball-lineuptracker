// Seeder voor de Firebase Emulator Suite (Auth + Firestore).
// Gebruikt firebase-admin — omzeilt Security Rules (bewuste keuze voor seeddata).
// Vereist: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 en FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
// (worden door `firebase emulators:exec` automatisch gezet).

import { generateKeyPairSync } from 'crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Genereer een wegwerp-RSA-sleutelpaar bij elke run. De emulator verifieert geen handtekeningen;
// cert() vereist enkel een syntactisch geldig PEM-sleutel om te kunnen parsen.
// Nooit een statische sleutel in Git opslaan — dit is de correcte emulator-aanpak.
const { privateKey: ephemeralKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ephemeralPem = ephemeralKey.export({ type: 'pkcs8', format: 'pem' }) as string;

const PROJECT_ID = 'demo-lineup-tracker-dev';

initializeApp({
  projectId: PROJECT_ID,
  credential: cert({
    projectId: PROJECT_ID,
    clientEmail: `seed@${PROJECT_ID}.iam.gserviceaccount.com`,
    privateKey: ephemeralPem,
  }),
});

const adminAuth = getAuth();
const db = getFirestore();
const now = FieldValue.serverTimestamp();

// ---- Hulpfuncties ----

async function createUser(uid: string, email: string, password: string, emailVerified: boolean): Promise<void> {
  try {
    await adminAuth.createUser({ uid, email, password, emailVerified });
  } catch (e: unknown) {
    // Gebruiker bestaat al (idempotent seed).
    const err = e as { code?: string };
    if (err.code !== 'auth/uid-already-exists') throw e;
  }
}

function orgRef(orgId: string) {
  return db.collection('organizations').doc(orgId);
}
function memberRef(orgId: string, uid: string) {
  return orgRef(orgId).collection('organizationMembers').doc(uid);
}
function invRef(orgId: string, invId: string) {
  return orgRef(orgId).collection('invitations').doc(invId);
}
function teamRef(orgId: string, teamId: string) {
  return orgRef(orgId).collection('teams').doc(teamId);
}
function teamMemberRef(orgId: string, teamId: string, uid: string) {
  return teamRef(orgId, teamId).collection('teamMembers').doc(uid);
}
function settingsRef(orgId: string, teamId: string) {
  return teamRef(orgId, teamId).collection('settings').doc('current');
}
function rosterRef(orgId: string, teamId: string) {
  return teamRef(orgId, teamId).collection('roster').doc('current');
}

// ---- Fictieve gebruikers ----
// Alle e-mailadressen: @example.test (nooit echt bestaand domein)

const USERS = {
  alice: { uid: 'uid-alice', email: 'alice@example.test', password: 'Spike123!', verified: true },
  bob: { uid: 'uid-bob', email: 'bob@example.test', password: 'Spike123!', verified: true },
  carol: { uid: 'uid-carol', email: 'carol@example.test', password: 'Spike123!', verified: true },
  dave: { uid: 'uid-dave', email: 'dave@example.test', password: 'Spike123!', verified: true },
  erin: { uid: 'uid-erin', email: 'erin@example.test', password: 'Spike123!', verified: true },
  frank: { uid: 'uid-frank', email: 'frank@example.test', password: 'Spike123!', verified: true },
  grace: { uid: 'uid-grace', email: 'grace@example.test', password: 'Spike123!', verified: true },
  henry: { uid: 'uid-henry', email: 'henry@example.test', password: 'Spike123!', verified: true },
  irene: { uid: 'uid-irene', email: 'irene@example.test', password: 'Spike123!', verified: true },
  jack: { uid: 'uid-jack', email: 'jack@example.test', password: 'Spike123!', verified: false }, // niet geverifieerd
  kevin: { uid: 'uid-kevin', email: 'kevin@example.test', password: 'Spike123!', verified: true }, // voor revocation-scenario
} as const;

// Fictieve spelers voor seed-data.
const SEED_PLAYERS_A = [
  { id: 1, nr: '4', naam: 'Fictief Speler Een', kl: '3.0', vrouw: false, jeugd: false },
  { id: 2, nr: '7', naam: 'Fictief Speler Twee', kl: '1.5', vrouw: true, jeugd: false },
  { id: 3, nr: '12', naam: 'Fictief Speler Drie', kl: '4.5', vrouw: false, jeugd: true },
];
const SEED_PLAYERS_B = [{ id: 1, nr: '5', naam: 'Fictief NBB Speler', kl: '2.0', vrouw: false, jeugd: false }];

const SEED_SETTINGS_A = {
  teamName: 'Rotterdam Basketball (fictief)',
  logoUri: '',
  primaryColor: '#e63946',
  accentColor: '#457b9d',
  quarterCount: 4,
  periodLabel: '',
  useClassLimit: true,
  tag1Label: 'Dames',
  tag2Label: 'Jeugd',
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1.0,
  bonusBoth: 2.0,
};
const SEED_SETTINGS_B = {
  teamName: 'NBB Selectie (fictief)',
  logoUri: '',
  primaryColor: '#2b9348',
  accentColor: '#aacc00',
  quarterCount: 4,
  periodLabel: '',
  useClassLimit: false,
  tag1Label: '',
  tag2Label: '',
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1.0,
  bonusBoth: 2.0,
};

async function seed(): Promise<void> {
  console.log('[seed] Aanmaken fictieve gebruikers...');
  await Promise.all(Object.values(USERS).map((u) => createUser(u.uid, u.email, u.password, u.verified)));

  // ============================================================
  // Org A: Rotterdam Basketball (fictief)
  // ============================================================
  const orgA = 'org-rotterdam';
  const teamA1 = 'team-u23';
  const teamA2 = 'team-u17';

  console.log('[seed] Org A aanmaken...');
  await orgRef(orgA).set({ name: 'Rotterdam Basketball (fictief)', createdBy: USERS.alice.uid, createdAt: now });

  // Memberships org A (alle 5 rollen komen ergens in de seed voor):
  // alice = organizationOwner (ook in org B als viewer → één gebruiker, twee orgs)
  // bob   = organizationAdmin
  // carol = coach  (team U23)
  // dave  = scorer (team U23)
  // erin  = viewer (team U23)
  // kevin = coach  (team U23) — gereserveerd voor revocation-test
  await memberRef(orgA, USERS.alice.uid).set({
    role: 'organizationOwner',
    email: USERS.alice.email,
    uid: USERS.alice.uid,
    joinedAt: now,
  });
  await memberRef(orgA, USERS.bob.uid).set({
    role: 'organizationAdmin',
    email: USERS.bob.email,
    uid: USERS.bob.uid,
    joinedAt: now,
  });

  console.log('[seed] Teams org A aanmaken...');
  await teamRef(orgA, teamA1).set({ name: 'U23 (fictief)', createdBy: USERS.alice.uid, createdAt: now });
  await teamRef(orgA, teamA2).set({ name: 'U17 (fictief)', createdBy: USERS.alice.uid, createdAt: now });

  // Team-memberships U23:
  await teamMemberRef(orgA, teamA1, USERS.carol.uid).set({ role: 'coach', email: USERS.carol.email, addedAt: now });
  await teamMemberRef(orgA, teamA1, USERS.dave.uid).set({ role: 'scorer', email: USERS.dave.email, addedAt: now });
  await teamMemberRef(orgA, teamA1, USERS.erin.uid).set({ role: 'viewer', email: USERS.erin.email, addedAt: now });
  await teamMemberRef(orgA, teamA1, USERS.kevin.uid).set({ role: 'coach', email: USERS.kevin.email, addedAt: now });

  console.log('[seed] Settings/roster org A...');
  await settingsRef(orgA, teamA1).set({ ...SEED_SETTINGS_A, updatedAt: now });
  await rosterRef(orgA, teamA1).set({ players: SEED_PLAYERS_A, updatedAt: now });
  await settingsRef(orgA, teamA2).set({ ...SEED_SETTINGS_A, teamName: 'Rotterdam U17 (fictief)', updatedAt: now });
  await rosterRef(orgA, teamA2).set({ players: [], updatedAt: now });

  // Uitnodigingen org A — dekken alle randgevallen voor bootstrap-and-invitation-flow.spec.ts:
  console.log('[seed] Uitnodigingen org A aanmaken...');

  // grace: lopende uitnodiging (pending), geverifieerd e-mailadres — kan accepteren.
  await invRef(orgA, 'inv-grace').set({
    email: USERS.grace.email,
    role: 'viewer',
    status: 'pending',
    invitedBy: USERS.bob.uid,
    invitedAt: now,
    acceptedAt: null,
  });

  // henry: ingetrokken uitnodiging — kan NIET claimen.
  await invRef(orgA, 'inv-henry').set({
    email: USERS.henry.email,
    role: 'coach',
    status: 'revoked',
    invitedBy: USERS.bob.uid,
    invitedAt: now,
    acceptedAt: null,
  });

  // irene: geaccepteerde uitnodiging maar membership nog niet geclaimed.
  await invRef(orgA, 'inv-irene').set({
    email: USERS.irene.email,
    role: 'scorer',
    status: 'accepted',
    invitedBy: USERS.bob.uid,
    invitedAt: now,
    acceptedAt: now,
  });

  // jack: lopende uitnodiging maar e-mail NIET geverifieerd — mag niet accepteren.
  await invRef(orgA, 'inv-jack').set({
    email: USERS.jack.email,
    role: 'viewer',
    status: 'pending',
    invitedBy: USERS.bob.uid,
    invitedAt: now,
    acceptedAt: null,
  });

  // ============================================================
  // Org B: NBB (fictief)
  // ============================================================
  const orgB = 'org-nbb';
  const teamB1 = 'team-selectie';

  console.log('[seed] Org B aanmaken...');
  await orgRef(orgB).set({ name: 'NBB (fictief)', createdBy: USERS.frank.uid, createdAt: now });

  // frank = organizationOwner in org B
  // alice = viewer in org B (dezelfde alice die owner is in org A — bewijst de #28-query)
  await memberRef(orgB, USERS.frank.uid).set({
    role: 'organizationOwner',
    email: USERS.frank.email,
    uid: USERS.frank.uid,
    joinedAt: now,
  });
  await memberRef(orgB, USERS.alice.uid).set({
    role: 'viewer',
    email: USERS.alice.email,
    uid: USERS.alice.uid,
    joinedAt: now,
  });

  await teamRef(orgB, teamB1).set({ name: 'NBB Selectie (fictief)', createdBy: USERS.frank.uid, createdAt: now });
  await settingsRef(orgB, teamB1).set({ ...SEED_SETTINGS_B, updatedAt: now });
  await rosterRef(orgB, teamB1).set({ players: SEED_PLAYERS_B, updatedAt: now });

  // Org-brede rollen (owner/admin uitgezonderd) geven sinds de PR 5.2-review geen impliciete
  // teamtoegang meer — alice (org-viewer) heeft een expliciet teamMembers-document nodig om
  // team-selectie te mogen zien/activeren in de contextwisselaar.
  await teamMemberRef(orgB, teamB1, USERS.alice.uid).set({
    role: 'viewer',
    email: USERS.alice.email,
    addedAt: now,
  });

  console.log('[seed] Klaar. 2 organisaties, 3 teams, 10 gebruikers geseed.');
}

seed().catch((err) => {
  console.error('[seed] FOUT:', err);
  process.exit(1);
});
