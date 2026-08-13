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
});
