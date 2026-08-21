// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseBackupPayload } from '../../src/domain/backup/parse';
import { BACKUP_TYPE } from '../../src/domain/backup/types';
import { V1_ACTIVE_GAME_STORAGE_KEY } from '../../src/domain/game/v1Migration';
import { ROSTER_STORAGE_KEY } from '../../src/domain/roster/types';
import { SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import { V1_GAMES_STORAGE_KEY } from '../../src/domain/backup/migrateV1';

/**
 * Herreview op PR #52 (aug. 2026): "valideer de volledige aanwezige
 * v1-secties vóór normalisatie/projectie [...] voeg regressies toe via de
 * publieke parseBackupPayload() met volledige v1-envelopes [...] en bewijs
 * errors.length > 0 / nul writes." Deze suite draait de reviewerprobes
 * door de ECHTE, publieke top-tot-teen-pijplijn (envelope → v1-migratie →
 * sectievalidatie) i.p.v. alleen de losse migreerfuncties — bewijst dat een
 * geconfirmeerde import op zo'n back-up daadwerkelijk NIETS zou schrijven
 * (`data` is dan altijd `{}`, zie `parse.ts`'s eigen contract).
 */
function v1Envelope(data: Record<string, unknown>) {
  return { type: BACKUP_TYPE, version: 1, exportedAt: '2026-01-01T00:00:00.000Z', data };
}

function v1Player(id: number, nr: string) {
  return {
    id,
    nr,
    naam: `Speler ${nr}`,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
  };
}

function v1Game(overrides: Record<string, unknown> = {}) {
  return {
    id: 'legacy-1',
    opponent: 'Tegenstander',
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

describe('domain/backup/parse — volledige v1-envelopepijplijn (herreview PR #52, aug. 2026)', () => {
  it('een geldige, volledige v1-envelope levert nul fouten en alle secties op', () => {
    const parsed = parseBackupPayload(
      v1Envelope({
        [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS, teamName: 'Rotterdam U23' },
        [ROSTER_STORAGE_KEY]: [
          { id: 1, nr: '1', naam: 'Anna', kl: '3.0', vrouw: false, jeugd: false },
        ],
        [V1_GAMES_STORAGE_KEY]: [v1Game()],
      }),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.data.settings?.teamName).toBe('Rotterdam U23');
    expect(parsed.data.roster).toHaveLength(1);
    expect(parsed.data.completedGames).toHaveLength(1);
    expect(parsed.data.completedGames?.[0]?.players.every((p) => p.participate)).toBe(true);
    expect(parsed.data.completedGames?.[0]?.players.every((p) => !p.start)).toBe(true);
  });

  it('een v1-wedstrijd met een string-getypeerde scoreFor levert errors op en NUL data (geen partiële import)', () => {
    const parsed = parseBackupPayload(
      v1Envelope({ [V1_GAMES_STORAGE_KEY]: [v1Game({ scoreFor: '6' })] }),
    );
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.data).toEqual({});
  });

  it('een roster met een niet-object entry levert errors op en NUL data', () => {
    const parsed = parseBackupPayload(
      v1Envelope({
        [ROSTER_STORAGE_KEY]: [
          { id: 1, nr: '1', naam: 'Anna', kl: '3.0', vrouw: false, jeugd: false },
          null,
        ],
      }),
    );
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.data).toEqual({});
  });

  it('settings met een ontbrekend veld levert errors op en NUL data (geen aangevulde defaults)', () => {
    const { teamName: _drop, ...incompleteSettings } = { ...DEFAULT_SETTINGS };
    void _drop;
    const parsed = parseBackupPayload(v1Envelope({ [SETTINGS_STORAGE_KEY]: incompleteSettings }));
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.data).toEqual({});
  });

  it('een malformed actieve v1-wedstrijd (players geen array) levert errors op en NUL data', () => {
    const parsed = parseBackupPayload(
      v1Envelope({ [V1_ACTIVE_GAME_STORAGE_KEY]: { players: 'not-an-array', phase: 'tracking' } }),
    );
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.data).toEqual({});
  });

  // Herreview op PR #52 (aug. 2026): twee v1-wedstrijden met hetzelfde
  // legacy-`Game.id` krijgen via de deterministische mapping
  // (`migrateV1.ts`) exact hetzelfde gemigreerde `id`/`sourceGameId` —
  // dat moet de VOLLEDIGE v1-import blokkeren (nul writes), niet stil twee
  // botsende entries opleveren.
  it('twee v1-wedstrijden met hetzelfde legacy Game.id worden geweigerd (nul writes)', () => {
    const parsed = parseBackupPayload(
      v1Envelope({
        [V1_GAMES_STORAGE_KEY]: [
          v1Game({ id: 'legacy-dup' }),
          v1Game({ id: 'legacy-dup', opponent: 'Andere tegenstander' }),
        ],
      }),
    );
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.data).toEqual({});
  });
});

/**
 * PR 7.2c, externe review op PR #65 (P1): dezelfde drie letterlijke probes
 * als `backupValidate.spec.ts`, hier tegen de ECHTE publieke
 * `parseBackupPayload()`-pijplijn (v2-envelope, geen v1-migratie ertussen)
 * — bewijst dat een geconfirmeerde import op zo'n back-up daadwerkelijk
 * NIETS zou schrijven (`data` blijft `{}`).
 */
function v2Envelope(data: Record<string, unknown>) {
  return { type: BACKUP_TYPE, version: 2, exportedAt: '2026-01-01T00:00:00.000Z', data };
}

function v2Player(id: string, rosterId: number) {
  return {
    id,
    rosterId,
    nr: String(rosterId),
    naam: `Speler ${rosterId}`,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  };
}

function v2CompletedGame(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'src-1',
    opponent: 'Tegenstander',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: [1, 2, 3, 4, 5].map((n) => v2Player(`p${n}`, n)),
    segments: [
      {
        id: 's1',
        quarter: 1,
        beginSec: 0,
        endSec: 100,
        durSec: 100,
        lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
        pf: 2,
        pa: 1,
        classSum: 0,
        allowed: 0,
        over: false,
      },
    ],
    scoreFor: 2,
    scoreAgainst: 1,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

describe('domain/backup/parse — v2-envelopepijplijn, tombstonevelden (externe review PR #65, aug. 2026)', () => {
  it('aanwezige maar fout-getypeerde tombstonevelden worden geweigerd (nul writes)', () => {
    const parsed = parseBackupPayload(
      v2Envelope({
        completedGames: [v2CompletedGame({ revision: 'bad', deletedAt: 123, deletedBy: false })],
      }),
    );
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.data).toEqual({});
  });

  it('een negatieve revision wordt geweigerd (geïsoleerd, nul writes)', () => {
    const parsed = parseBackupPayload(
      v2Envelope({
        completedGames: [
          v2CompletedGame({
            revision: -4,
            deletedAt: '2026-01-05T00:00:00.000Z',
            deletedBy: 'uid',
          }),
        ],
      }),
    );
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.data).toEqual({});
  });

  // Tweede externe-reviewronde op PR #65 (P1): de vorige probe combineerde
  // `deletedAt:'not-iso'` met `revision:-4` en bewees zo niets over de
  // ISO-timestampcontrole zelf (de revisiefout alleen was al genoeg om te
  // slagen) — `deletedAt` werd toen slechts op `typeof === 'string'`
  // gecontroleerd. Geïsoleerd hier, met verder geldige tombstonevelden.
  it('een niet-ISO deletedAt wordt geweigerd (geïsoleerd, nul writes)', () => {
    const parsed = parseBackupPayload(
      v2Envelope({
        completedGames: [v2CompletedGame({ revision: 1, deletedAt: 'not-iso', deletedBy: 'uid' })],
      }),
    );
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.data).toEqual({});
  });

  it('een lege deletedBy wordt geweigerd (geïsoleerd, nul writes)', () => {
    const parsed = parseBackupPayload(
      v2Envelope({
        completedGames: [
          v2CompletedGame({ revision: 1, deletedAt: '2026-01-05T00:00:00.000Z', deletedBy: '' }),
        ],
      }),
    );
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.data).toEqual({});
  });

  it('een inconsistente tombstonestatus (deletedBy zonder deletedAt) wordt geweigerd (nul writes)', () => {
    const parsed = parseBackupPayload(
      v2Envelope({
        completedGames: [v2CompletedGame({ revision: 0, deletedAt: null, deletedBy: 'uid' })],
      }),
    );
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.data).toEqual({});
  });

  it('een geldige v2-completedGames-sectie met een echte tombstone importeert wél', () => {
    const parsed = parseBackupPayload(
      v2Envelope({
        completedGames: [
          v2CompletedGame({
            revision: 1,
            deletedAt: '2026-01-05T00:00:00.000Z',
            deletedBy: 'uid-alice',
          }),
        ],
      }),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.data.completedGames).toHaveLength(1);
  });
});
