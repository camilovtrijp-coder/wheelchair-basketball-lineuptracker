import type { BackupEnvelope } from '../../domain/backup/types';

/**
 * DOM-bijwerkende poort voor het downloaden van een back-uppayload — zelfde
 * blob-`<a download>`-patroon als `infrastructure/game/shareOrDownloadCsv.ts`,
 * zonder Web Share API (een back-up is bewust géén deel-actie: v1 deelde
 * back-ups ook nooit, alleen CSV-exports van één wedstrijd).
 */
export function downloadBackupFile(payload: BackupEnvelope, filename: string): void {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
