// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  migrateV1BackupData,
  migrateV1CompletedGame,
  retagWithContext,
  V1_GAMES_STORAGE_KEY,
} from '../../src/domain/backup/migrateV1';
import { V1_ACTIVE_GAME_STORAGE_KEY } from '../../src/domain/game/v1Migration';
import { ROSTER_STORAGE_KEY } from '../../src/domain/roster/types';
import { SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import { LANG_STORAGE_KEY } from '../../src/i18n/strings';

function v1Player(id: number, nr: string, naam = `Speler ${nr}`) {
  return {
    id,
    nr,
    naam,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  };
}

function v1Game(overrides: Record<string, unknown> = {}) {
  return {
    id: 'legacy-game-1',
    opponent: 'Oude tegenstander',
    competition: '',
    date: '2025-01-01T10:00:00.000Z',
    players: [
      v1Player(1, '1'),
      v1Player(2, '2'),
      v1Player(3, '3'),
      v1Player(4, '4'),
      v1Player(5, '5'),
    ],
    segments: [
      {
        quarter: 1,
        beginSec: 0,
        endSec: 100,
        durSec: 100,
        lineup: [1, 2, 3, 4, 5],
        pf: 6,
        pa: 4,
        classSum: 0,
        allowed: 0,
        over: false,
      },
    ],
    scoreFor: 6,
    scoreAgainst: 4,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    ...overrides,
  };
}

describe('domain/backup/migrateV1 — migrateV1CompletedGame (plan §D/§G.9)', () => {
  it('projecteert spelers/segmenten met rosterId-behoud en herschreven lineup-referenties', () => {
    const migrated = migrateV1CompletedGame(v1Game());
    expect(migrated).not.toBeNull();
    expect(migrated!.players).toHaveLength(5);
    expect(migrated!.players.map((p) => p.rosterId).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(migrated!.segments).toHaveLength(1);
    expect(migrated!.segments[0]!.lineup).toHaveLength(5);
    // lineup-ID's zijn herschreven naar de nieuwe game-player-UUID's, niet
    // meer de kale v1-rosterId's.
    const knownIds = new Set(migrated!.players.map((p) => p.id));
    for (const id of migrated!.segments[0]!.lineup) expect(knownIds.has(id)).toBe(true);
    expect(migrated!.scoreFor).toBe(6);
    expect(migrated!.scoreAgainst).toBe(4);
    expect(migrated!.sourceGameId).toBe('v1-import:legacy-game-1');
    // Context-vrij: retagging gebeurt pas na bevestiging.
    expect(migrated!.organizationId).toBe('');
    expect(migrated!.teamId).toBe('');
  });

  it('geeft null voor niet-plain-object input', () => {
    expect(migrateV1CompletedGame('x')).toBeNull();
    expect(migrateV1CompletedGame(null)).toBeNull();
  });

  it('geeft null (fail-closed) bij een ontbrekend Game.id of Game.date i.p.v. te defaulten', () => {
    const { id: _id, ...withoutId } = v1Game();
    void _id;
    expect(migrateV1CompletedGame(withoutId)).toBeNull();
    const { date: _date, ...withoutDate } = v1Game();
    void _date;
    expect(migrateV1CompletedGame(withoutDate)).toBeNull();
  });

  it('geeft null (fail-closed) bij een corrupt spelers- of segmentitem i.p.v. te defaulten', () => {
    expect(
      migrateV1CompletedGame(v1Game({ players: [null, ...v1Game().players.slice(1)] })),
    ).toBeNull();
    expect(migrateV1CompletedGame(v1Game({ segments: [null] }))).toBeNull();
  });

  it('is deterministisch: tweemaal migreren van exact dezelfde v1-wedstrijd levert een identiek object op', () => {
    const a = migrateV1CompletedGame(v1Game());
    const b = migrateV1CompletedGame(v1Game());
    expect(a).toEqual(b);
  });

  // Herreview op PR #52 (aug. 2026): `str(..., '')`/`num(..., 0)`-fallbacks
  // maskeerden eerder een aanwezige-maar-fout-getypeerde v1-waarde als een
  // stille default, vóórdat validatie de typefout kon zien.
  it('geeft null (fail-closed) bij een string-getypeerde scoreFor i.p.v. deze stil naar 0 te vertalen', () => {
    expect(migrateV1CompletedGame(v1Game({ scoreFor: '6' }))).toBeNull();
    expect(migrateV1CompletedGame(v1Game({ scoreAgainst: '4' }))).toBeNull();
    expect(migrateV1CompletedGame(v1Game({ quarterCount: '4' }))).toBeNull();
  });

  it('geeft null (fail-closed) bij ontbrekende/verkeerd-getypeerde metadata (opponent/competition/periodLabel/useClassLimit)', () => {
    expect(migrateV1CompletedGame(v1Game({ opponent: 42 }))).toBeNull();
    const { competition: _c, ...withoutCompetition } = v1Game();
    void _c;
    expect(migrateV1CompletedGame(withoutCompetition)).toBeNull();
    expect(migrateV1CompletedGame(v1Game({ useClassLimit: 'ja' }))).toBeNull();
  });

  it('geeft null (fail-closed) bij verkeerd-getypeerde spelersvelden (nr/naam/kl/vrouw/jeugd/participate/start)', () => {
    const badPlayers: unknown[] = v1Game().players.slice();
    badPlayers[0] = { ...(badPlayers[0] as Record<string, unknown>), nr: 9 };
    expect(migrateV1CompletedGame(v1Game({ players: badPlayers }))).toBeNull();
  });
});

describe('domain/backup/migrateV1 — migrateV1BackupData (plan §D/§G.1)', () => {
  it('projecteert een volledige v1-back-up naar alle vijf secties', () => {
    const raw = {
      [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS, teamName: 'Rotterdam U23' },
      [ROSTER_STORAGE_KEY]: [
        { id: 1, nr: '1', naam: 'Anna', kl: '3.0', vrouw: false, jeugd: false },
      ],
      [LANG_STORAGE_KEY]: 'en',
      [V1_GAMES_STORAGE_KEY]: [v1Game()],
      [V1_ACTIVE_GAME_STORAGE_KEY]: {
        players: [
          v1Player(1, '1'),
          v1Player(2, '2'),
          v1Player(3, '3'),
          v1Player(4, '4'),
          v1Player(5, '5'),
        ],
        phase: 'tracking',
        onCourt: [1, 2, 3, 4, 5],
        segments: [],
        scoreFor: 0,
        scoreAgainst: 0,
      },
    };
    const { data, errors } = migrateV1BackupData(raw);
    expect(errors).toEqual([]);
    expect(data.settings?.teamName).toBe('Rotterdam U23');
    expect(data.roster).toHaveLength(1);
    expect(data.lang).toBe('en');
    expect(data.completedGames).toHaveLength(1);
    expect(data.activeGame).not.toBeNull();
    expect(data.activeGame!.phase).toBe('tracking');
  });

  it('een ontbrekende sleutel levert een afwezige (undefined) sectie op', () => {
    const { data, errors } = migrateV1BackupData({
      [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS },
    });
    expect(errors).toEqual([]);
    expect(data.settings).toBeDefined();
    expect(data.roster).toBeUndefined();
    expect(data.activeGame).toBeUndefined();
    expect(data.completedGames).toBeUndefined();
    expect(data.lang).toBeUndefined();
  });

  it('een niet-hervatbare v1-actieve-wedstrijd (fase setup) levert geen activeGame-sectie op', () => {
    const { data, errors } = migrateV1BackupData({
      [V1_ACTIVE_GAME_STORAGE_KEY]: { players: [], phase: 'setup', segments: [] },
    });
    expect(errors).toEqual([]);
    expect(data.activeGame).toBeUndefined();
  });

  it('faalt fail-closed (geen stille filtering) wanneer één wedstrijd in de lijst corrupt is', () => {
    const { data, errors } = migrateV1BackupData({
      [V1_GAMES_STORAGE_KEY]: [v1Game(), null, v1Game({ id: 'legacy-game-2' })],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.code === 'migrationFailed')).toBe(true);
    // Bij een migratiefout wordt GEEN enkele sectie teruggegeven — ook niet
    // de wél geldige wedstrijden — zodat een bevestiging nooit een
    // gedeeltelijke (stil ingekorte) historie kan importeren.
    expect(data.completedGames).toBeUndefined();
  });

  // Externe PR-6.6-review (aug. 2026): `lineup-tracker-settings: null` mocht
  // eerder stil via `normalizeSettings()` naar `DEFAULT_SETTINGS` vallen —
  // bij een bevestigde import zou dat geldige doelsettings overschrijven
  // met defaults i.p.v. de import te weigeren.
  it('faalt fail-closed op malformed settings (null) i.p.v. stil DEFAULT_SETTINGS te gebruiken', () => {
    const { data, errors } = migrateV1BackupData({ [SETTINGS_STORAGE_KEY]: null });
    expect(errors.some((e) => e.code === 'migrationFailed' && e.detail === 'settings')).toBe(true);
    expect(data.settings).toBeUndefined();
  });

  // `lineup-tracker-roster: "not-an-array"` mocht eerder stil via
  // `normalizeRoster()` naar `[]` vallen — bij bevestiging zou dat een
  // geldig doelroster legen.
  it('faalt fail-closed op malformed roster (geen array) i.p.v. stil te legen', () => {
    const { data, errors } = migrateV1BackupData({ [ROSTER_STORAGE_KEY]: 'not-an-array' });
    expect(errors.some((e) => e.code === 'migrationFailed' && e.detail === 'roster')).toBe(true);
    expect(data.roster).toBeUndefined();
  });

  // Herreview op PR #52 (aug. 2026): `normalizeRoster()` filtert een
  // niet-object entry stil weg (`[validPlayer, null]` → `[validPlayer]`) —
  // legitiem voor de live-app-boot, maar bij een back-up-import hoort dat
  // de HELE migratie te blokkeren, niet het roster stil in te korten.
  it('faalt fail-closed op een roster met een niet-object entry (i.p.v. deze stil te filteren)', () => {
    const validPlayer = {
      id: 1,
      nr: '1',
      naam: 'Anna',
      kl: '3.0',
      vrouw: false,
      jeugd: false,
    };
    const { data, errors } = migrateV1BackupData({
      [ROSTER_STORAGE_KEY]: [validPlayer, null],
    });
    expect(errors.some((e) => e.code === 'migrationFailed' && e.detail === 'roster')).toBe(true);
    expect(data.roster).toBeUndefined();
  });

  it('faalt fail-closed op een roster-item met een verkeerd-getypeerd veld (nr als getal i.p.v. string)', () => {
    const { data, errors } = migrateV1BackupData({
      [ROSTER_STORAGE_KEY]: [{ id: 1, nr: 9, naam: 'Anna', kl: '3.0', vrouw: false, jeugd: false }],
    });
    expect(errors.some((e) => e.code === 'migrationFailed' && e.detail === 'roster')).toBe(true);
    expect(data.roster).toBeUndefined();
  });

  // v1's eigen `validateSettings()` wijst ontbrekende settingsvelden af —
  // `normalizeSettings()` vult die eerder stil aan met defaults, wat bij
  // een back-up-import geldige doelsettings gedeeltelijk zou overschrijven
  // met defaultwaarden voor de ontbrekende velden.
  it('faalt fail-closed op settings met een ontbrekend veld i.p.v. deze aan te vullen met defaults', () => {
    const { teamName: _drop, ...incompleteSettings } = { ...DEFAULT_SETTINGS };
    void _drop;
    const { data, errors } = migrateV1BackupData({ [SETTINGS_STORAGE_KEY]: incompleteSettings });
    expect(errors.some((e) => e.code === 'migrationFailed' && e.detail === 'settings')).toBe(true);
    expect(data.settings).toBeUndefined();
  });

  it('faalt fail-closed op een ongeldige taalcode i.p.v. de sectie stil weg te laten', () => {
    const { data, errors } = migrateV1BackupData({ [LANG_STORAGE_KEY]: 'xx-not-a-lang' });
    expect(errors.some((e) => e.code === 'migrationFailed' && e.detail === 'lang')).toBe(true);
    expect(data.lang).toBeUndefined();
  });

  // Een gecombineerde probe: malformed settings/roster naast een geldige
  // taal moet NOG STEEDS de volledige migratie laten falen (geen enkele
  // sectie teruggeven, ook niet de wél geldige taal).
  it('een gecombineerde malformed-settings+roster-probe met geldige taal faalt volledig (geen enkele sectie)', () => {
    const { data, errors } = migrateV1BackupData({
      [SETTINGS_STORAGE_KEY]: null,
      [ROSTER_STORAGE_KEY]: 'not-an-array',
      [LANG_STORAGE_KEY]: 'en',
    });
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(data.settings).toBeUndefined();
    expect(data.roster).toBeUndefined();
    expect(data.lang).toBeUndefined();
  });

  // Een structureel onbruikbare actieve wedstrijd (players is geen array)
  // is een migratiefout — dat is iets anders dan v1's legitieme "opzet nog
  // niet gestart, dus niet hervatbaar"-uitzondering (zie de test hierboven
  // met `phase: 'setup'`), die WEL een lege (undefined) sectie mag opleveren.
  it('faalt fail-closed op een structureel malformed activeGame (players geen array), i.t.t. de legitieme niet-hervatbare uitzondering', () => {
    const { data, errors } = migrateV1BackupData({
      [V1_ACTIVE_GAME_STORAGE_KEY]: { players: 'not-an-array', phase: 'tracking' },
    });
    expect(errors.some((e) => e.code === 'migrationFailed' && e.detail === 'activeGame')).toBe(
      true,
    );
    expect(data.activeGame).toBeUndefined();
  });

  it('een afwezige/`null` actieve wedstrijd blijft geen migratiefout (legitiem "geen wedstrijd")', () => {
    const { errors: errorsNull } = migrateV1BackupData({ [V1_ACTIVE_GAME_STORAGE_KEY]: null });
    expect(errorsNull).toEqual([]);
    const { errors: errorsAbsent } = migrateV1BackupData({});
    expect(errorsAbsent).toEqual([]);
  });
});

describe('domain/backup/migrateV1 — retagWithContext (plan §D)', () => {
  it('tagt activeGame en completedGames met de bevestigde doelcontext', () => {
    const migrated = migrateV1CompletedGame(v1Game())!;
    const tagged = retagWithContext({ completedGames: [migrated] }, 'org-x', 'team-y');
    expect(tagged.completedGames![0]!.organizationId).toBe('org-x');
    expect(tagged.completedGames![0]!.teamId).toBe('team-y');
  });

  it('laat activeGame: null ongewijzigd (blijft expliciet "geen wedstrijd")', () => {
    const tagged = retagWithContext({ activeGame: null }, 'org-x', 'team-y');
    expect(tagged.activeGame).toBeNull();
  });

  it('laat een afwezige sectie afwezig', () => {
    const tagged = retagWithContext({}, 'org-x', 'team-y');
    expect(tagged.activeGame).toBeUndefined();
    expect(tagged.completedGames).toBeUndefined();
  });
});
