// Round-trip-tests voor de typed Firestore-documentcontracten. Pure logica,
// geen Emulator nodig: een minimale mock-QueryDocumentSnapshot volstaat om
// fromFirestore() te oefenen; toFirestore() wordt direct op een voorbeeld-
// object aangeroepen.

import { describe, expect, it } from 'vitest';
import { Timestamp, type QueryDocumentSnapshot } from 'firebase/firestore';
import {
  organizationConverter,
  organizationMemberConverter,
  invitationConverter,
  teamConverter,
  teamMemberConverter,
  settingsConverter,
  rosterConverter,
  gameConverter,
  gameActionConverter,
  completedGameConverter,
  DocumentValidationError,
  type OrganizationDocument,
  type OrganizationMemberDocument,
  type InvitationDocument,
  type TeamDocument,
  type TeamMemberDocument,
  type SettingsDocument,
  type RosterDocument,
  type GameDocument,
  type GameActionEnvelopeDocument,
  type CompletedGameDocument,
} from '../../src/documents/index.js';

// `path` is alleen relevant voor converters die contextvelden tegen het
// Firestore-pad valideren (game/gameAction, PR 7.1a-review); de andere
// converters lezen `snapshot.ref` niet, dus de placeholder default is voor
// hen onschadelijk.
function mockSnapshot<T extends Record<string, unknown>>(
  data: T,
  path = 'mock/doc',
): QueryDocumentSnapshot {
  return {
    data: () => data,
    ref: { path },
  } as unknown as QueryDocumentSnapshot;
}

const GAME_PATH = 'organizations/org-1/teams/team-1/games/game-1';
const COMPLETED_GAME_PATH = 'organizations/org-1/teams/team-1/completedGames/completed-1';
function gameActionPath(actionId: string): string {
  return `organizations/org-1/teams/team-1/games/game-1/actions/${actionId}`;
}

describe('documentcontracten: round-trip via toFirestore/fromFirestore', () => {
  it('organization', () => {
    const doc: OrganizationDocument = {
      name: 'Fictieve Org',
      createdBy: 'uid-alice',
      createdAt: Timestamp.now(),
    };
    const stored = organizationConverter.toFirestore(doc);
    expect(
      organizationConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>), {}),
    ).toEqual(doc);
  });

  it('organizationMember bevat het uid-veld (issue #28-queryveld)', () => {
    const doc: OrganizationMemberDocument = {
      role: 'organizationOwner',
      email: 'alice@example.test',
      uid: 'uid-alice',
      joinedAt: Timestamp.now(),
    };
    const stored = organizationMemberConverter.toFirestore(doc);
    const roundtripped = organizationMemberConverter.fromFirestore!(
      mockSnapshot(stored as Record<string, unknown>),
      {},
    );
    expect(roundtripped).toEqual(doc);
    expect(roundtripped.uid).toBe('uid-alice');
  });

  it('invitation', () => {
    const doc: InvitationDocument = {
      email: 'grace@example.test',
      role: 'viewer',
      status: 'pending',
      invitedBy: 'uid-bob',
      invitedAt: Timestamp.now(),
      acceptedAt: null,
    };
    const stored = invitationConverter.toFirestore(doc);
    expect(
      invitationConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>), {}),
    ).toEqual(doc);
  });

  it('team bevat het orgName-veld (issue #31 — leesbaar voor team-only leden zonder organizations/{orgId}-toegang)', () => {
    const doc: TeamDocument = {
      name: 'U23',
      orgName: 'Rotterdam Basketball',
      createdBy: 'uid-alice',
      createdAt: Timestamp.now(),
    };
    const stored = teamConverter.toFirestore(doc);
    expect(
      teamConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>), {}),
    ).toEqual(doc);
  });

  it('teamMember bevat het uid-veld (issue #31-queryveld)', () => {
    const doc: TeamMemberDocument = {
      role: 'coach',
      email: 'carol@example.test',
      uid: 'uid-carol',
      addedAt: Timestamp.now(),
    };
    const stored = teamMemberConverter.toFirestore(doc);
    const roundtripped = teamMemberConverter.fromFirestore!(
      mockSnapshot(stored as Record<string, unknown>),
      {},
    );
    expect(roundtripped).toEqual(doc);
    expect(roundtripped.uid).toBe('uid-carol');
  });

  it('settings', () => {
    const doc: SettingsDocument = {
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
      updatedAt: Timestamp.now(),
    };
    const stored = settingsConverter.toFirestore(doc);
    expect(
      settingsConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>), {}),
    ).toEqual(doc);
  });

  it('roster', () => {
    const doc: RosterDocument = {
      players: [
        {
          id: 1,
          nr: '7',
          naam: 'Fictief Speler',
          kl: '3.0',
          vrouw: false,
          jeugd: false,
        },
      ],
      updatedAt: Timestamp.now(),
    };
    const stored = rosterConverter.toFirestore(doc);
    expect(
      rosterConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>), {}),
    ).toEqual(doc);
  });

  it('game (PR 7.1a)', () => {
    const doc: GameDocument = {
      organizationId: 'org-1',
      teamId: 'team-1',
      phase: 'tracking',
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
      onCourt: ['gp-1'],
      curQuarter: 2,
      beginSec: 600,
      endSec: 540,
      pendingSwapLineup: null,
      scoreFor: 12,
      scoreAgainst: 9,
      segmentCount: 1,
      writerUid: 'uid-alice',
      deviceId: 'device-1',
      writerEpoch: 1,
      revision: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:05:00.000Z',
      completedGameId: null,
      updatedAt: Timestamp.now(),
    };
    const stored = gameConverter.toFirestore(doc);
    expect(
      gameConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>, GAME_PATH), {}),
    ).toEqual(doc);
  });

  it('game met completedGameId gezet (PR 7.2a)', () => {
    const doc: GameDocument = {
      organizationId: 'org-1',
      teamId: 'team-1',
      phase: 'tracking',
      players: [],
      opponent: 'Fictieve Tegenstander',
      competition: 'Fictieve Competitie',
      clockDown: true,
      limitStr: '14.5',
      onCourt: [],
      curQuarter: 4,
      beginSec: 0,
      endSec: 0,
      pendingSwapLineup: null,
      scoreFor: 40,
      scoreAgainst: 32,
      segmentCount: 8,
      writerUid: 'uid-alice',
      deviceId: 'device-1',
      writerEpoch: 0,
      revision: 9,
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:05:00.000Z',
      completedGameId: 'completed-1',
      updatedAt: Timestamp.now(),
    };
    const stored = gameConverter.toFirestore(doc);
    expect(
      gameConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>, GAME_PATH), {}),
    ).toEqual(doc);
  });

  it('completedGame (PR 7.2a)', () => {
    const doc: CompletedGameDocument = {
      organizationId: 'org-1',
      teamId: 'team-1',
      sourceGameId: 'game-1',
      opponent: 'Fictieve Tegenstander',
      competition: 'Fictieve Competitie',
      date: '2026-01-01T01:30:00.000Z',
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
      segments: [
        {
          id: 'seg-1',
          quarter: 1,
          beginSec: 600,
          endSec: 480,
          durSec: 120,
          lineup: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
          pf: 4,
          pa: 2,
          classSum: 14.0,
          allowed: 14.5,
          over: false,
        },
      ],
      scoreFor: 40,
      scoreAgainst: 32,
      quarterCount: 4,
      periodLabel: 'kwart',
      useClassLimit: true,
      syncedAt: Timestamp.now(),
      revision: 0,
      deletedAt: null,
      deletedBy: null,
    };
    const stored = completedGameConverter.toFirestore(doc);
    expect(
      completedGameConverter.fromFirestore!(
        mockSnapshot(stored as Record<string, unknown>, COMPLETED_GAME_PATH),
        {},
      ),
    ).toEqual(doc);
  });

  it('completedGame: getombstoned (PR 7.2c)', () => {
    const deletedAt = Timestamp.now();
    const doc: CompletedGameDocument = {
      organizationId: 'org-1',
      teamId: 'team-1',
      sourceGameId: 'game-1',
      opponent: 'Fictieve Tegenstander',
      competition: 'Fictieve Competitie',
      date: '2026-01-01T01:30:00.000Z',
      players: [],
      segments: [],
      scoreFor: 40,
      scoreAgainst: 32,
      quarterCount: 4,
      periodLabel: 'kwart',
      useClassLimit: true,
      syncedAt: Timestamp.now(),
      revision: 1,
      deletedAt,
      deletedBy: 'uid-alice',
    };
    const stored = completedGameConverter.toFirestore(doc);
    expect(
      completedGameConverter.fromFirestore!(
        mockSnapshot(stored as Record<string, unknown>, COMPLETED_GAME_PATH),
        {},
      ),
    ).toEqual(doc);
  });

  it('gameAction: score-delta (PR 7.1a)', () => {
    const doc: GameActionEnvelopeDocument = {
      organizationId: 'org-1',
      teamId: 'team-1',
      gameId: 'game-1',
      actionId: 'action-1',
      authorUid: 'uid-alice',
      deviceId: 'device-1',
      writerEpoch: 1,
      sequence: 0,
      occurredAt: '2026-01-01T00:10:00.000Z',
      schemaVersion: 1,
      action: { type: 'score-delta', team: 'for', delta: 2 },
    };
    const stored = gameActionConverter.toFirestore(doc);
    expect(
      gameActionConverter.fromFirestore!(
        mockSnapshot(stored as Record<string, unknown>, gameActionPath('action-1')),
        {},
      ),
    ).toEqual(doc);
  });

  it('gameAction: segment-saved (PR 7.1a)', () => {
    const doc: GameActionEnvelopeDocument = {
      organizationId: 'org-1',
      teamId: 'team-1',
      gameId: 'game-1',
      actionId: 'action-2',
      authorUid: 'uid-alice',
      deviceId: 'device-1',
      writerEpoch: 1,
      sequence: 1,
      occurredAt: '2026-01-01T00:12:00.000Z',
      schemaVersion: 1,
      action: {
        type: 'segment-saved',
        segment: {
          id: 'seg-1',
          quarter: 1,
          beginSec: 600,
          endSec: 480,
          durSec: 120,
          lineup: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
          pf: 4,
          pa: 2,
          classSum: 14.0,
          allowed: 14.5,
          over: false,
        },
      },
    };
    const stored = gameActionConverter.toFirestore(doc);
    expect(
      gameActionConverter.fromFirestore!(
        mockSnapshot(stored as Record<string, unknown>, gameActionPath('action-2')),
        {},
      ),
    ).toEqual(doc);
  });

  it('gameAction: segment-deleted (PR 7.1a)', () => {
    const doc: GameActionEnvelopeDocument = {
      organizationId: 'org-1',
      teamId: 'team-1',
      gameId: 'game-1',
      actionId: 'action-3',
      authorUid: 'uid-alice',
      deviceId: 'device-1',
      writerEpoch: 1,
      sequence: 2,
      occurredAt: '2026-01-01T00:13:00.000Z',
      schemaVersion: 1,
      action: { type: 'segment-deleted', segmentId: 'seg-1' },
    };
    const stored = gameActionConverter.toFirestore(doc);
    expect(
      gameActionConverter.fromFirestore!(
        mockSnapshot(stored as Record<string, unknown>, gameActionPath('action-3')),
        {},
      ),
    ).toEqual(doc);
  });
});

// Review-opvolging #29 (P2): de converters waren type-projecties, geen
// runtime-decoders — `snapshot.data()` levert ongevalideerde `DocumentData`.
// Deze tests bewijzen dat malformed serverdata nu wordt geweigerd i.p.v.
// stilzwijgend als het getypte document te worden teruggegeven.
describe('documentcontracten: weigeren malformed serverdata', () => {
  const validMember: Record<string, unknown> = {
    role: 'organizationOwner',
    email: 'alice@example.test',
    uid: 'uid-alice',
    joinedAt: Timestamp.now(),
  };
  const validSettings: Record<string, unknown> = {
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
    updatedAt: Timestamp.now(),
  };
  const validRoster: Record<string, unknown> = {
    players: [
      {
        id: 1,
        nr: '7',
        naam: 'Fictief Speler',
        kl: '3.0',
        vrouw: false,
        jeugd: false,
      },
    ],
    updatedAt: Timestamp.now(),
  };
  const validInvitation: Record<string, unknown> = {
    email: 'grace@example.test',
    role: 'viewer',
    status: 'pending',
    invitedBy: 'uid-bob',
    invitedAt: Timestamp.now(),
    acceptedAt: null,
  };
  const validTeamMember: Record<string, unknown> = {
    role: 'coach',
    email: 'carol@example.test',
    uid: 'uid-carol',
    addedAt: Timestamp.now(),
  };
  const validOrganization: Record<string, unknown> = {
    name: 'Fictieve Org',
    createdBy: 'uid-alice',
    createdAt: Timestamp.now(),
  };

  it('organizationMember: onbekende rol wordt geweigerd', () => {
    expect(() =>
      organizationMemberConverter.fromFirestore!(
        mockSnapshot({ ...validMember, role: 'superadmin' }),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('organizationMember: niet-string uid wordt geweigerd (issue #28-queryveld)', () => {
    expect(() =>
      organizationMemberConverter.fromFirestore!(mockSnapshot({ ...validMember, uid: 12345 }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('organizationMember: ontbrekend e-mailadres wordt geweigerd', () => {
    const { email: _email, ...withoutEmail } = validMember;
    expect(() =>
      organizationMemberConverter.fromFirestore!(mockSnapshot(withoutEmail), {}),
    ).toThrow(DocumentValidationError);
  });

  it('organizationMember: ongeldig e-mailadres (geen @) wordt geweigerd', () => {
    expect(() =>
      organizationMemberConverter.fromFirestore!(
        mockSnapshot({ ...validMember, email: 'geen-emailadres' }),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('invitation: onbekende status wordt geweigerd', () => {
    expect(() =>
      invitationConverter.fromFirestore!(
        mockSnapshot({ ...validInvitation, status: 'ingetrokken' }),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('invitation: ontbrekende invitedAt-timestamp wordt geweigerd', () => {
    const { invitedAt: _invitedAt, ...withoutInvitedAt } = validInvitation;
    expect(() => invitationConverter.fromFirestore!(mockSnapshot(withoutInvitedAt), {})).toThrow(
      DocumentValidationError,
    );
  });

  it('invitation: string in plaats van Timestamp voor invitedAt wordt geweigerd', () => {
    expect(() =>
      invitationConverter.fromFirestore!(
        mockSnapshot({ ...validInvitation, invitedAt: '2026-01-01' }),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('teamMember: onbekende rol wordt geweigerd', () => {
    expect(() =>
      teamMemberConverter.fromFirestore!(
        mockSnapshot({ ...validTeamMember, role: 'niet-bestaand' }),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('teamMember: niet-string uid wordt geweigerd (issue #31-queryveld)', () => {
    expect(() =>
      teamMemberConverter.fromFirestore!(mockSnapshot({ ...validTeamMember, uid: 12345 }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('team: ontbrekende orgName wordt geweigerd (issue #31)', () => {
    const validTeam: Record<string, unknown> = {
      name: 'U23',
      orgName: 'Rotterdam Basketball',
      createdBy: 'uid-alice',
      createdAt: Timestamp.now(),
    };
    const { orgName: _orgName, ...withoutOrgName } = validTeam;
    expect(() => teamConverter.fromFirestore!(mockSnapshot(withoutOrgName), {})).toThrow(
      DocumentValidationError,
    );
  });

  it('organization: ontbrekende createdAt-timestamp wordt geweigerd', () => {
    const { createdAt: _createdAt, ...withoutCreatedAt } = validOrganization;
    expect(() => organizationConverter.fromFirestore!(mockSnapshot(withoutCreatedAt), {})).toThrow(
      DocumentValidationError,
    );
  });

  it('settings: niet-numerieke quarterCount wordt geweigerd', () => {
    expect(() =>
      settingsConverter.fromFirestore!(mockSnapshot({ ...validSettings, quarterCount: '4' }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('settings: niet-boolean useClassLimit wordt geweigerd', () => {
    expect(() =>
      settingsConverter.fromFirestore!(
        mockSnapshot({ ...validSettings, useClassLimit: 'true' }),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('settings: ontbrekende updatedAt-timestamp wordt geweigerd', () => {
    const { updatedAt: _updatedAt, ...withoutUpdatedAt } = validSettings;
    expect(() => settingsConverter.fromFirestore!(mockSnapshot(withoutUpdatedAt), {})).toThrow(
      DocumentValidationError,
    );
  });

  it('roster: players die geen array is wordt geweigerd', () => {
    expect(() =>
      rosterConverter.fromFirestore!(
        mockSnapshot({ ...validRoster, players: 'niet-een-array' }),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('roster: speler-entry die geen object is wordt geweigerd', () => {
    expect(() =>
      rosterConverter.fromFirestore!(
        mockSnapshot({ ...validRoster, players: ['niet-een-object'] }),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('roster: speler met niet-numerieke id wordt geweigerd', () => {
    const malformedPlayer = {
      id: '1',
      nr: '7',
      naam: 'Fictief Speler',
      kl: '3.0',
      vrouw: false,
      jeugd: false,
    };
    expect(() =>
      rosterConverter.fromFirestore!(
        mockSnapshot({ ...validRoster, players: [malformedPlayer] }),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('roster: speler met niet-boolean vrouw-vlag wordt geweigerd', () => {
    const malformedPlayer = {
      id: 1,
      nr: '7',
      naam: 'Fictief Speler',
      kl: '3.0',
      vrouw: 'nee',
      jeugd: false,
    };
    expect(() =>
      rosterConverter.fromFirestore!(
        mockSnapshot({ ...validRoster, players: [malformedPlayer] }),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  // PR 7.1a — het wedstrijdmodel (docs/pr-7.1-plan.md §C 7.1a): "converters
  // roundtrippen geldige fictieve wedstrijden en weigeren malformed nested
  // spelers, segmenten, actions, timestamps en contextvelden".
  const validGamePlayer: Record<string, unknown> = {
    id: 'gp-1',
    rosterId: 1,
    nr: '7',
    naam: 'Fictief Speler',
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  };
  const validGame: Record<string, unknown> = {
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: [validGamePlayer],
    opponent: 'Fictieve Tegenstander',
    competition: 'Fictieve Competitie',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-1'],
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
    completedGameId: null,
    updatedAt: Timestamp.now(),
  };
  const validSegment: Record<string, unknown> = {
    id: 'seg-1',
    quarter: 1,
    beginSec: 600,
    endSec: 480,
    durSec: 120,
    lineup: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
    pf: 4,
    pa: 2,
    classSum: 14.0,
    allowed: 14.5,
    over: false,
  };
  const validGameAction: Record<string, unknown> = {
    organizationId: 'org-1',
    teamId: 'team-1',
    gameId: 'game-1',
    actionId: 'action-1',
    authorUid: 'uid-alice',
    deviceId: 'device-1',
    writerEpoch: 1,
    sequence: 0,
    occurredAt: '2026-01-01T00:10:00.000Z',
    schemaVersion: 1,
    action: { type: 'score-delta', team: 'for', delta: 2 },
  };

  it('game: onbekende fase wordt geweigerd', () => {
    expect(() =>
      gameConverter.fromFirestore!(
        mockSnapshot({ ...validGame, phase: 'afgerond' }, GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('game: ontbrekende organizationId (contextveld) wordt geweigerd', () => {
    const { organizationId: _organizationId, ...withoutOrgId } = validGame;
    expect(() => gameConverter.fromFirestore!(mockSnapshot(withoutOrgId, GAME_PATH), {})).toThrow(
      DocumentValidationError,
    );
  });

  // Externe review PR 7.1a: organizationId/teamId werden alleen op
  // aanwezigheid/type gecontroleerd, niet tegen het daadwerkelijke
  // Firestore-pad — een document met een geldige maar VERKEERDE
  // organizationId/teamId werd stilzwijgend geaccepteerd.
  it('game: organizationId die niet overeenkomt met het Firestore-pad wordt geweigerd', () => {
    expect(() =>
      gameConverter.fromFirestore!(
        mockSnapshot({ ...validGame, organizationId: 'org-2' }, GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('game: teamId die niet overeenkomt met het Firestore-pad wordt geweigerd', () => {
    expect(() =>
      gameConverter.fromFirestore!(mockSnapshot({ ...validGame, teamId: 'team-2' }, GAME_PATH), {}),
    ).toThrow(DocumentValidationError);
  });

  it('game: speler-entry die geen object is wordt geweigerd', () => {
    expect(() =>
      gameConverter.fromFirestore!(
        mockSnapshot({ ...validGame, players: ['niet-een-object'] }, GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('game: onCourt die geen array van strings is wordt geweigerd', () => {
    expect(() =>
      gameConverter.fromFirestore!(
        mockSnapshot({ ...validGame, onCourt: [1, 2, 3] }, GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('game: niet-geheel getal curQuarter wordt geweigerd', () => {
    expect(() =>
      gameConverter.fromFirestore!(mockSnapshot({ ...validGame, curQuarter: 1.5 }, GAME_PATH), {}),
    ).toThrow(DocumentValidationError);
  });

  it('game: ontbrekende updatedAt-timestamp wordt geweigerd', () => {
    const { updatedAt: _updatedAt, ...withoutUpdatedAt } = validGame;
    expect(() =>
      gameConverter.fromFirestore!(mockSnapshot(withoutUpdatedAt, GAME_PATH), {}),
    ).toThrow(DocumentValidationError);
  });

  // Reviewerprobe (externe review PR 7.1a): een niet-lege, maar niet-
  // parseerbare string voor een client-autoritatief tijdveld werd voorheen
  // geaccepteerd ("moet een string zijn" volstond niet).
  it('game: niet-ISO-string voor createdAt wordt geweigerd', () => {
    expect(() =>
      gameConverter.fromFirestore!(
        mockSnapshot({ ...validGame, createdAt: 'dit-is-geen-tijdstip' }, GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('game: niet-ISO-string voor startedAt wordt geweigerd', () => {
    expect(() =>
      gameConverter.fromFirestore!(
        mockSnapshot({ ...validGame, startedAt: 'dit-is-geen-tijdstip' }, GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  // Tweede reviewerprobe (externe review PR 7.1a): een kale Date.parse()-
  // check accepteerde ook niet-ISO-formaten ("January 1, 2026") en
  // normaliseerde een onmogelijke kalenderdatum stilzwijgend ("2026-02-31"
  // → 3 maart) i.p.v. te weigeren. assertIsoTimestampString() eist nu een
  // strikte round-trip via toISOString().
  it('game: parseerbare maar niet-ISO-string voor createdAt wordt geweigerd', () => {
    expect(() =>
      gameConverter.fromFirestore!(
        mockSnapshot({ ...validGame, createdAt: 'January 1, 2026' }, GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('game: onmogelijke kalenderdatum voor createdAt wordt geweigerd (geen stille normalisatie)', () => {
    expect(() =>
      gameConverter.fromFirestore!(
        mockSnapshot({ ...validGame, createdAt: '2026-02-31T00:00:00.000Z' }, GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('game: parseerbare maar niet-ISO-string voor startedAt wordt geweigerd', () => {
    expect(() =>
      gameConverter.fromFirestore!(
        mockSnapshot({ ...validGame, startedAt: 'January 1, 2026' }, GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('game: onmogelijke kalenderdatum voor startedAt wordt geweigerd (geen stille normalisatie)', () => {
    expect(() =>
      gameConverter.fromFirestore!(
        mockSnapshot({ ...validGame, startedAt: '2026-02-31T00:00:00.000Z' }, GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('gameAction: onbekend actietype wordt geweigerd', () => {
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot(
          {
            ...validGameAction,
            action: { type: 'score-multiply', team: 'for', delta: 2 },
          },
          gameActionPath('action-1'),
        ),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('gameAction: onbekende schemaversie wordt fail-closed geweigerd', () => {
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot({ ...validGameAction, schemaVersion: 2 }, gameActionPath('action-1')),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('gameAction: onbekend team op score-delta wordt geweigerd', () => {
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot(
          {
            ...validGameAction,
            action: { type: 'score-delta', team: 'neutraal', delta: 2 },
          },
          gameActionPath('action-1'),
        ),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('gameAction: segment-saved met malformed genest segment wordt geweigerd', () => {
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot(
          {
            ...validGameAction,
            action: {
              type: 'segment-saved',
              segment: { ...validSegment, lineup: 'niet-een-array' },
            },
          },
          gameActionPath('action-1'),
        ),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('gameAction: segment-edited zonder segmentId wordt geweigerd', () => {
    const { segmentId: _segmentId, ...actionWithoutSegmentId } = {
      type: 'segment-edited',
      segmentId: 'seg-1',
      segment: validSegment,
    };
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot(
          { ...validGameAction, action: actionWithoutSegmentId },
          gameActionPath('action-1'),
        ),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('gameAction: niet-geheel getal sequence wordt geweigerd', () => {
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot({ ...validGameAction, sequence: 1.5 }, gameActionPath('action-1')),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  // Reviewerprobe (externe review PR 7.1a): een niet-parseerbare
  // occurredAt-string werd voorheen geaccepteerd.
  it('gameAction: niet-ISO-string voor occurredAt wordt geweigerd', () => {
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot(
          { ...validGameAction, occurredAt: 'dit-is-geen-tijdstip' },
          gameActionPath('action-1'),
        ),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  // Tweede reviewerprobe (externe review PR 7.1a): parseerbare niet-ISO-
  // string en onmogelijke kalenderdatum, zelfde strikte round-trip-eis als
  // bij game.createdAt/startedAt hierboven.
  it('gameAction: parseerbare maar niet-ISO-string voor occurredAt wordt geweigerd', () => {
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot(
          { ...validGameAction, occurredAt: 'January 1, 2026' },
          gameActionPath('action-1'),
        ),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('gameAction: onmogelijke kalenderdatum voor occurredAt wordt geweigerd (geen stille normalisatie)', () => {
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot(
          { ...validGameAction, occurredAt: '2026-02-31T00:00:00.000Z' },
          gameActionPath('action-1'),
        ),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  // Reviewerprobe (externe review PR 7.1a): vier afwijkende contextvelden
  // (organizationId/teamId/gameId/actionId) werden niet tegen het
  // daadwerkelijke Firestore-pad gecontroleerd.
  it('gameAction: organizationId die niet overeenkomt met het Firestore-pad wordt geweigerd', () => {
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot({ ...validGameAction, organizationId: 'org-2' }, gameActionPath('action-1')),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('gameAction: teamId die niet overeenkomt met het Firestore-pad wordt geweigerd', () => {
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot({ ...validGameAction, teamId: 'team-2' }, gameActionPath('action-1')),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('gameAction: gameId die niet overeenkomt met het Firestore-pad wordt geweigerd', () => {
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot({ ...validGameAction, gameId: 'game-2' }, gameActionPath('action-1')),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('gameAction: actionId die niet overeenkomt met het Firestore-pad wordt geweigerd', () => {
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot({ ...validGameAction, actionId: 'action-9' }, gameActionPath('action-1')),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('gameAction: ontbrekende gameId (contextveld) wordt geweigerd', () => {
    const { gameId: _gameId, ...withoutGameId } = validGameAction;
    expect(() =>
      gameActionConverter.fromFirestore!(
        mockSnapshot(withoutGameId, gameActionPath('action-1')),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  // PR 7.2a: completedGameId is nullable-string, net als writerUid/deviceId.
  it('game: niet-string completedGameId wordt geweigerd', () => {
    expect(() =>
      gameConverter.fromFirestore!(
        mockSnapshot({ ...validGame, completedGameId: 42 }, GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  const validCompletedGame: Record<string, unknown> = {
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'game-1',
    opponent: 'Fictieve Tegenstander',
    competition: 'Fictieve Competitie',
    date: '2026-01-01T01:30:00.000Z',
    players: [validGamePlayer],
    segments: [validSegment],
    scoreFor: 40,
    scoreAgainst: 32,
    quarterCount: 4,
    periodLabel: 'kwart',
    useClassLimit: true,
    syncedAt: Timestamp.now(),
  };

  it('completedGame: ontbrekende sourceGameId wordt geweigerd', () => {
    const { sourceGameId: _sourceGameId, ...withoutSourceGameId } = validCompletedGame;
    expect(() =>
      completedGameConverter.fromFirestore!(
        mockSnapshot(withoutSourceGameId, COMPLETED_GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('completedGame: organizationId die niet overeenkomt met het Firestore-pad wordt geweigerd', () => {
    expect(() =>
      completedGameConverter.fromFirestore!(
        mockSnapshot({ ...validCompletedGame, organizationId: 'org-2' }, COMPLETED_GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('completedGame: teamId die niet overeenkomt met het Firestore-pad wordt geweigerd', () => {
    expect(() =>
      completedGameConverter.fromFirestore!(
        mockSnapshot({ ...validCompletedGame, teamId: 'team-2' }, COMPLETED_GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('completedGame: segments die geen array is wordt geweigerd', () => {
    expect(() =>
      completedGameConverter.fromFirestore!(
        mockSnapshot({ ...validCompletedGame, segments: 'niet-een-array' }, COMPLETED_GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('completedGame: malformed genest segment wordt geweigerd', () => {
    expect(() =>
      completedGameConverter.fromFirestore!(
        mockSnapshot(
          { ...validCompletedGame, segments: [{ ...validSegment, lineup: 'niet-een-array' }] },
          COMPLETED_GAME_PATH,
        ),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('completedGame: malformed genest speler wordt geweigerd', () => {
    expect(() =>
      completedGameConverter.fromFirestore!(
        mockSnapshot(
          { ...validCompletedGame, players: [{ ...validGamePlayer, id: 42 }] },
          COMPLETED_GAME_PATH,
        ),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('completedGame: niet-ISO-string voor date wordt geweigerd', () => {
    expect(() =>
      completedGameConverter.fromFirestore!(
        mockSnapshot({ ...validCompletedGame, date: 'dit-is-geen-tijdstip' }, COMPLETED_GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('completedGame: ontbrekende syncedAt-timestamp wordt geweigerd', () => {
    const { syncedAt: _syncedAt, ...withoutSyncedAt } = validCompletedGame;
    expect(() =>
      completedGameConverter.fromFirestore!(
        mockSnapshot(withoutSyncedAt, COMPLETED_GAME_PATH),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });
});
