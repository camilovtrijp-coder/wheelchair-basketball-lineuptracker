import type { BackupV2Data, ImportPreview, SectionEffect } from './types';

/**
 * Bouwt een neutrale preview uit reeds-gevalideerde back-updata (plan
 * §C.6) — nog geen writes. `effect` volgt het replace-per-onderdeel-
 * contract uit eigenaarsbesluit §E.2: sectie aanwezig → `'replace'`,
 * sectie afwezig → `'clear'` (v1-pariteit: een ontbrekende back-upsleutel
 * betekende `localStorage.removeItem`). `activeGame: null` is een
 * expliciete "clear" met een bekende reden (geen wedstrijd in de bron),
 * geen ontbrekende sectie.
 */
export function buildImportPreview(
  data: BackupV2Data,
  sourceVersion: number,
  exportedAt: string | null,
): ImportPreview {
  const effectFor = (present: boolean): SectionEffect => (present ? 'replace' : 'clear');

  return {
    sourceVersion,
    exportedAt,
    settings: {
      present: data.settings !== undefined,
      effect: effectFor(data.settings !== undefined),
      teamName: data.settings?.teamName ?? null,
    },
    roster: {
      present: data.roster !== undefined,
      effect: effectFor(data.roster !== undefined),
      playerCount: data.roster?.length ?? 0,
    },
    activeGame: {
      // Zowel afwezig (v1: geen back-upsleutel) als expliciet `null`
      // (v2-native: "op dit moment geen actieve wedstrijd") leiden tot
      // hetzelfde effect — leeg maken. Alleen een echt game-object is een
      // vervanging.
      present: data.activeGame !== undefined,
      effect: data.activeGame ? 'replace' : 'clear',
      opponent: data.activeGame ? data.activeGame.opponent : null,
    },
    completedGames: {
      present: data.completedGames !== undefined,
      effect: effectFor(data.completedGames !== undefined),
      count: data.completedGames?.length ?? 0,
    },
    lang: {
      present: data.lang !== undefined,
      effect: data.lang !== undefined ? 'replace' : 'unchanged',
      value: data.lang ?? null,
    },
  };
}
