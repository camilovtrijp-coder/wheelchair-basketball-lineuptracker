// Fictieve constanten gedeeld door alle rules-specs.
// Geen échte spelersdata, geen echte e-mailadressen.

export const ORG_A = 'org-rotterdam';
export const ORG_B = 'org-nbb';
export const TEAM_A1 = 'team-u23';
export const TEAM_A2 = 'team-u17';
export const TEAM_B1 = 'team-selectie';

export const USERS = {
  alice: { uid: 'uid-alice', email: 'alice@example.test', emailVerified: true },
  bob: { uid: 'uid-bob', email: 'bob@example.test', emailVerified: true },
  carol: { uid: 'uid-carol', email: 'carol@example.test', emailVerified: true },
  dave: { uid: 'uid-dave', email: 'dave@example.test', emailVerified: true },
  erin: { uid: 'uid-erin', email: 'erin@example.test', emailVerified: true },
  frank: { uid: 'uid-frank', email: 'frank@example.test', emailVerified: true },
  grace: { uid: 'uid-grace', email: 'grace@example.test', emailVerified: true },
  henry: { uid: 'uid-henry', email: 'henry@example.test', emailVerified: true },
  irene: { uid: 'uid-irene', email: 'irene@example.test', emailVerified: true },
  jack: { uid: 'uid-jack', email: 'jack@example.test', emailVerified: false },
  kevin: { uid: 'uid-kevin', email: 'kevin@example.test', emailVerified: true },
} as const;

export const SAMPLE_SETTINGS = {
  teamName: 'Fictief Team',
  logoUri: '',
  primaryColor: '#2563eb',
  accentColor: '#f97316',
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

export const SAMPLE_ROSTER = {
  players: [{ id: 1, nr: '7', naam: 'Fictief Speler', kl: '3.0', vrouw: false, jeugd: false }],
};

// PR 7.1b — cloudkopie van ActiveGame (zie firebase/src/documents/game.ts).
// `writerUid`/`deviceId` blijven hier bewust `null` (nog geen claim) tenzij
// een spec ze expliciet overschrijft.
export function sampleGame(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_A,
    teamId: TEAM_A1,
    phase: 'setup',
    players: [
      {
        id: 'gp-1',
        rosterId: 1,
        nr: '7',
        naam: 'Fictief Speler',
        kl: '3.0',
        vrouw: false,
        jeugd: false,
        participate: true,
        start: true,
      },
    ],
    opponent: 'Fictieve Tegenstander',
    competition: 'Fictieve Competitie',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [],
    curQuarter: 1,
    beginSec: 600,
    endSec: 600,
    pendingSwapLineup: null,
    scoreFor: 0,
    scoreAgainst: 0,
    segmentCount: 0,
    writerUid: null,
    deviceId: null,
    writerEpoch: 0,
    revision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    ...overrides,
  };
}

// PR 7.1b — cloudkopie van een score-delta GameAction (zie
// firebase/src/documents/gameAction.ts). Het pad zelf draagt gameId/actionId
// al; deze payload draagt ze ook (contextvelden, PR 7.1a-review).
export function sampleGameAction(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_A,
    teamId: TEAM_A1,
    gameId: 'game-1',
    actionId: 'action-1',
    authorUid: USERS.alice.uid,
    deviceId: 'device-1',
    writerEpoch: 0,
    sequence: 0,
    occurredAt: '2026-01-01T00:10:00.000Z',
    schemaVersion: 1,
    action: { type: 'score-delta', team: 'for', delta: 2 },
    ...overrides,
  };
}
