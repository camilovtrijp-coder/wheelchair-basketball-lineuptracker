/**
 * PR 8.2b (docs/pr-8.2-plan.md §C 8.2b werk 3/4, bug 10 §B punt 4): pure
 * WCAG-contrastberekening en afgeleide-leesbare-voorgrondkleur-logica voor
 * `primaryColor`/`accentColor`.
 *
 * Herzien na een P1-bevinding (review op PR #83, 28 aug. 2026): een eerdere
 * versie toetste `primaryColor`/`accentColor` alleen tegen de LICHTE-modus-
 * vaste kleuren (`--lt-color-accent-fg`/`--lt-color-surface`) en toonde bij
 * onvoldoende contrast enkel een niet-blokkerende waarschuwing — maar
 * `tokens.css`'s `@media (prefers-color-scheme: dark)`-blok wijzigt die
 * vaste kleuren, waardoor de DEFAULT-teamkleuren in donkere modus daadwerkelijk
 * onder de AA-drempel renderden (axe-core `color-contrast`-schending),
 * zonder dat de waarschuwing dat kon zien (die rekende alleen de lichte-
 * modus-combinatie). In plaats van per kleurenschema te waarschuwen, kiest
 * deze module nu een daadwerkelijk leesbare voorgrondkleur (`pickReadable-
 * Color`) — wiskundig gegarandeerd ≥4.5:1 contrast tegen ELKE achtergrond
 * (zie `pickReadableColor`'s commentaar), dus geldig in beide
 * kleurenschema's zonder per-schema onderscheid nodig te hebben voor de
 * knoptekst, en met een expliciete per-schema achtergrond voor de
 * headertitel (die achtergrond verandert wél per schema). Er is hierdoor
 * geen "onvoldoende contrast"-toestand meer mogelijk voor deze twee
 * toepassingen — de niet-blokkerende waarschuwing uit de eerdere versie is
 * vervallen, niet meer nodig.
 */

export const AA_TEXT_CONTRAST_THRESHOLD = 4.5;

/** Vaste headerachtergrond (`.app-header`, via `--lt-color-surface`) per
 * kleurenschema — zie tokens.css. `accentColor` wordt hiertegen getoetst;
 * `primaryColor`/`.btn-primary` heeft geen aparte lichte/donkere achtergrond
 * nodig omdat de knopachtergrond altijd de teamkleur zelf is, ongeacht
 * kleurenschema (zie `deriveButtonForeground`). */
export const HEADER_BACKGROUND_LIGHT = '#f9fafb';
export const HEADER_BACKGROUND_DARK = '#111827';

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
 * Reden dat `deriveButtonForeground`/`deriveAccentForeground` hieronder
 * ALTIJD aan `AA_TEXT_CONTRAST_THRESHOLD` (4.5:1) voldoen zodra `'#ffffff'`
 * en `'#000000'` allebei in `candidates` zitten: voor een achtergrond met
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

/** Leesbare tekstkleur voor `.app-title` tegen een specifieke header-
 * achtergrond (licht óf donker — de aanroeper geeft de juiste vaste
 * achtergrond mee per schema, zie `HEADER_BACKGROUND_LIGHT`/`_DARK`).
 * Behoudt de daadwerkelijk gekozen `accentColor` wanneer die zelf al
 * voldoende contrast geeft (merkbaarder dan een geforceerde wit/zwart-val);
 * valt anders terug op wit-of-zwart, met dezelfde ≥4.5:1-garantie. */
export function deriveAccentForeground(accentColor: string, background: string): string {
  return pickReadableColor([accentColor, '#ffffff', '#000000'], background);
}
