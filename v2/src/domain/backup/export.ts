import {
  BACKUP_TYPE,
  CURRENT_BACKUP_VERSION,
  type BackupEnvelope,
  type BackupV2Data,
} from './types';

/** v1: `slugify()`, hergebruikt patroon uit `domain/game/csv.ts` voor de bestandsnaam. */
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'lineup-tracker'
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Bouwt de v2-back-uppayload (plan §C/§D 6.6a). Puur: de aanroeper (infra)
 * verzorgt de daadwerkelijke download. `data` bevat alleen de secties die
 * de aanroeper meegeeft — `undefined` secties worden niet geserialiseerd
 * (`JSON.stringify` laat `undefined`-properties vanzelf weg), zodat een
 * back-up van een team zonder actieve wedstrijd geen `activeGame: null`
 * hoeft te bevatten tenzij dat expliciet bedoeld is.
 */
export function buildBackupPayload(
  data: BackupV2Data,
  now: Date = new Date(),
  source?: { organizationId: string; teamId: string },
): BackupEnvelope {
  return {
    type: BACKUP_TYPE,
    version: CURRENT_BACKUP_VERSION,
    exportedAt: now.toISOString(),
    ...(source ? { source } : {}),
    data,
  };
}

/** v1: `exportBackup()`'s bestandsnaamopbouw, ongewijzigd patroon. */
export function backupFilename(teamName: string, now: Date = new Date()): string {
  return `${slugify(teamName || 'lineup-tracker')}-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
}
