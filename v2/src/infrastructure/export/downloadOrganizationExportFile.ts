import type { OrganizationExportV1 } from '../../domain/export/types';
import { serializeOrganizationExport } from '../../domain/export/roundtrip';

/**
 * PR 8.3b deel 2/2: DOM-bijwerkende poort voor het downloaden van een reeds
 * geverifieerde organisatie-export — zelfde blob-`<a download>`-patroon als
 * `infrastructure/backup/downloadBackupFile.ts`. Serialiseert met
 * `serializeOrganizationExport()` (niet een losse `JSON.stringify()`), zodat
 * het gedownloade bestand exact overeenkomt met wat
 * `verifyOrganizationExportRoundtrip()` al heeft geverifieerd.
 */
export function downloadOrganizationExportFile(data: OrganizationExportV1, filename: string): void {
  const blob = new Blob([serializeOrganizationExport(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
