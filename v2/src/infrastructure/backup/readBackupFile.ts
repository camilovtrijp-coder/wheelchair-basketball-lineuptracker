import { MAX_BACKUP_FILE_BYTES } from '../../domain/backup/types';

export type ReadBackupFileResult =
  | { ok: true; raw: unknown }
  | { ok: false; reason: 'fileTooLarge' | 'fileUnreadable' | 'fileNotJson' };

/**
 * DOM-bijwerkende poort voor het inlezen van een gekozen back-upbestand
 * (plan §C.1: max 10 MiB, gecontroleerd VÓÓR `FileReader`/JSON-parse en
 * zonder writes). Puur qua contract: geeft alleen het geparste JSON-object
 * terug of een foutreden — validatie/migratie blijft in
 * `domain/backup/parse.ts`.
 */
export function readBackupFile(file: File): Promise<ReadBackupFileResult> {
  if (file.size > MAX_BACKUP_FILE_BYTES) {
    return Promise.resolve({ ok: false, reason: 'fileTooLarge' });
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve({ ok: false, reason: 'fileUnreadable' });
    reader.onload = () => {
      const text = reader.result;
      if (typeof text !== 'string') {
        resolve({ ok: false, reason: 'fileUnreadable' });
        return;
      }
      try {
        resolve({ ok: true, raw: JSON.parse(text) });
      } catch {
        resolve({ ok: false, reason: 'fileNotJson' });
      }
    };
    reader.readAsText(file);
  });
}
