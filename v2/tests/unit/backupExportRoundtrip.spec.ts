// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildBackupPayload, backupFilename } from '../../src/domain/backup/export';
import { parseBackupPayload } from '../../src/domain/backup/parse';
import { BACKUP_TYPE, CURRENT_BACKUP_VERSION } from '../../src/domain/backup/types';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';

describe('domain/backup/export — buildBackupPayload/backupFilename', () => {
  it('bouwt een envelope met type/version/exportedAt/data', () => {
    const now = new Date('2026-03-04T12:00:00.000Z');
    const payload = buildBackupPayload({ settings: { ...DEFAULT_SETTINGS } }, now, {
      organizationId: 'org-1',
      teamId: 'team-1',
    });
    expect(payload.type).toBe(BACKUP_TYPE);
    expect(payload.version).toBe(CURRENT_BACKUP_VERSION);
    expect(payload.exportedAt).toBe('2026-03-04T12:00:00.000Z');
    expect(payload.source).toEqual({ organizationId: 'org-1', teamId: 'team-1' });
  });

  it('bouwt een deterministische bestandsnaam op basis van teamnaam en datum', () => {
    const now = new Date('2026-03-04T12:00:00.000Z');
    expect(backupFilename('Rotterdam U23', now)).toBe('rotterdam-u23-backup-20260304.json');
    expect(backupFilename('', now)).toBe('lineup-tracker-backup-20260304.json');
  });
});

describe('domain/backup/export + parse — v2-roundtrip (plan §G.1)', () => {
  it('een geëxporteerde back-up is na JSON-serialisatie weer geldig en identiek te lezen', () => {
    const data = {
      settings: { ...DEFAULT_SETTINGS, teamName: 'Rotterdam U23' },
      roster: [{ id: 1, nr: '1', naam: 'Anna', kl: '3.0', vrouw: false, jeugd: false }],
      activeGame: null,
      completedGames: [],
      lang: 'nl' as const,
    };
    const payload = buildBackupPayload(data);
    // Simuleert de echte roundtrip: JSON.stringify (download) -> JSON.parse (import).
    const roundtripped = JSON.parse(JSON.stringify(payload));
    const parsed = parseBackupPayload(roundtripped);
    expect(parsed.errors).toEqual([]);
    expect(parsed.data.settings?.teamName).toBe('Rotterdam U23');
    expect(parsed.data.roster).toHaveLength(1);
    expect(parsed.data.activeGame).toBeNull();
    expect(parsed.data.completedGames).toEqual([]);
    expect(parsed.data.lang).toBe('nl');
  });

  it('turnovers (segment.tov en een turnover-delta-actie) overleven export en import; oude segmenten zonder tov ook', () => {
    const player = (n: number) => ({
      id: `p${n}`,
      rosterId: n,
      nr: String(n),
      naam: `Speler ${n}`,
      kl: '3.0',
      vrouw: false,
      jeugd: false,
      participate: true,
      start: true,
    });
    const seg = (id: string, extra: object) => ({
      id,
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
      ...extra,
    });
    const game = {
      id: 'g1',
      organizationId: 'o',
      teamId: 't',
      sourceGameId: 'a1',
      opponent: 'X',
      competition: '',
      date: '2026-03-04T12:00:00.000Z',
      players: [1, 2, 3, 4, 5].map(player),
      segments: [seg('s-new', { tov: 3 }), seg('s-old', {})],
      scoreFor: 4,
      scoreAgainst: 2,
      quarterCount: 4,
      periodLabel: 'Kwart',
      useClassLimit: false,
      revision: 0,
      deletedAt: null,
      deletedBy: null,
    };
    const payload = buildBackupPayload({ completedGames: [game as never] });
    const parsed = parseBackupPayload(JSON.parse(JSON.stringify(payload)));
    expect(parsed.errors).toEqual([]);
    const segments = parsed.data.completedGames?.[0]?.segments ?? [];
    expect(segments[0]?.tov).toBe(3);
    expect(segments[1]?.tov).toBeUndefined();
  });
});
