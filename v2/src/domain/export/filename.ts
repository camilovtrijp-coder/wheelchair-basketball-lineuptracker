/** PR 8.3b deel 2/2: bestandsnaamopbouw voor de gedownloade organisatie-
 * export. Zelfde `slugify()`-patroon als `domain/backup/export.ts`'s
 * `backupFilename()` (op zijn beurt al hergebruikt van `domain/game/csv.ts`)
 * — bewust GEEN gedeelde helper: elke aanroeper heeft een eigen, kleine
 * kopie, en een export is functioneel iets anders dan een team-back-up (zie
 * `types.ts`'s docstring), dus een eigen bestandsnaam met "organisatie-
 * export" in plaats van "backup" voorkomt verwarring tussen de twee. */
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'organisatie'
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function organizationExportFilename(
  organizationName: string,
  now: Date = new Date(),
): string {
  return `${slugify(organizationName || 'organisatie')}-organisatie-export-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
}
