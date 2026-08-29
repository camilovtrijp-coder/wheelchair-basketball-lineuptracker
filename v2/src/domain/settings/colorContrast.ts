/**
 * PR 8.2b (docs/pr-8.2-plan.md §C 8.2b werk 3/4, bug 10 §B punt 4): pure
 * WCAG-contrastberekening en afgeleide-leesbare-voorgrondkleur-logica voor
 * `primaryColor` (`.btn-primary`'s tekstkleur).
 *
 * Herzien twee keer na reviewbevindingen op PR #83 (28 aug. 2026):
 *
 * 1. Een eerste versie toetste `primaryColor`/`accentColor` alleen tegen de
 *    LICHTE-modus-vaste kleuren en toonde bij onvoldoende contrast een
 *    niet-blokkerende waarschuwing — maar `tokens.css`'s
 *    `@media (prefers-color-scheme: dark)`-blok wijzigt die vaste kleuren,
 *    waardoor de DEFAULT-teamkleuren in donkere modus daadwerkelijk onder
 *    de AA-drempel renderden (axe-core `color-contrast`). Opgelost door
 *    `primaryColor` niet meer tegen een vaste tekstkleur te toetsen, maar
 *    een daadwerkelijk leesbare voorgrond te KIEZEN (`pickReadableColor`)
 *    — wiskundig gegarandeerd ≥4.5:1 tegen ELKE achtergrond (zie
 *    `pickReadableColor`'s commentaar), dus geldig in beide
 *    kleurenschema's zonder per-schema onderscheid nodig te hebben (de
 *    knopachtergrond zelf wisselt niet met het schema).
 * 2. Diezelfde aanpak, toegepast op `accentColor`/`.app-title` tegen de
 *    headerachtergrond, bleek een TWEEDE probleem te geven: geen van de
 *    tien kleurpresets in `SettingsPanel.tsx` haalt 4.5:1 tegen de lichte
 *    headerachtergrond, dus alle tien vielen terug op exact hetzelfde
 *    zwart — de accentkeuze werd daardoor onzichtbaar in de gangbare
 *    lichte modus. `accentColor` wordt daarom NIET meer als tekstkleur
 *    gebruikt; `App.tsx`/`index.css` passen 'm toe als een puur decoratief
 *    accent (`.app-title`'s `border-left`), waar WCAG 1.4.11 (non-text
 *    contrast) niet geldt — de rauwe kleur is daar dus altijd correct,
 *    geen afleidingsfunctie hier nodig.
 */

export const AA_TEXT_CONTRAST_THRESHOLD = 4.5;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{6})$/;

export function hexToRgb(hex: string): Rgb | null {
  const match = HEX_COLOR_PATTERN.exec(hex);
  const value = match?.[1];
  if (!value) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/** WCAG-contrastratio tussen twee kleuren (1..21). Retourneert `0` bij een
 * ongeldige hex-kleur. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return 0;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Kiest de eerste kandidaat die `minRatio` haalt tegen `background`; haalt
 * geen enkele kandidaat de drempel, dan de kandidaat met de hoogste ratio
 * (altijd een geldige, gedefinieerde terugvalwaarde — nooit `undefined`,
 * ook niet met `noUncheckedIndexedAccess`).
 *
 * Reden dat `deriveButtonForeground` hieronder ALTIJD aan
 * `AA_TEXT_CONTRAST_THRESHOLD` (4.5:1) voldoet zodra `'#ffffff'` en
 * `'#000000'` allebei in `candidates` zitten: voor een achtergrond met
 * relatieve luminantie L is de contrastratio tegen wit `1.05/(L+0.05)` en
 * tegen zwart `(L+0.05)/0.05`. De grootste van deze twee functies heeft een
 * minimum van ≈4.58 (bij L≈0.179, waar beide gelijk zijn) — dus
 * `max(ratio(wit), ratio(zwart)) ≥ 4.58 > 4.5` voor ELKE achtergrondkleur.
 * Geverifieerd door de "garantie geldt voor elke achtergrond"-test in
 * `tests/unit/colorContrast.spec.ts`.
 */
export function pickReadableColor(
  candidates: readonly string[],
  background: string,
  minRatio: number = AA_TEXT_CONTRAST_THRESHOLD,
): string {
  let best = candidates[0] ?? '#000000';
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, background);
    if (ratio >= minRatio) return candidate;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  return best;
}

/** Leesbare tekstkleur voor `.btn-primary`: de achtergrond is altijd
 * `primaryColor` zelf (kleurenschema-onafhankelijk — geen inline stijl
 * wijzigt met `prefers-color-scheme`), dus wit-of-zwart-kiezen is hier
 * genoeg en geldt automatisch in beide schema's (zie `pickReadableColor`). */
export function deriveButtonForeground(primaryColor: string): string {
  return pickReadableColor(['#ffffff', '#000000'], primaryColor);
}
