/**
 * PR 8.2b (docs/pr-8.2-plan.md §C 8.2b werk 4, bug 10 §B punt 4): pure
 * WCAG-contrastberekening voor `primaryColor`/`accentColor`. Toetst tegen
 * de vaste (niet-teamgekleurde) achtergrond-/tekstkleuren waar deze twee
 * kleuren daadwerkelijk tegen gerenderd worden (index.css):
 *  - `primaryColor` is de achtergrond van `.btn-primary`, met een vaste
 *    witte knoptekst (`--lt-color-accent-fg` in lichte modus) erop;
 *  - `accentColor` is de tekstkleur van `.app-title` op de vaste
 *    `--lt-color-surface`-achtergrond van `.app-header`.
 * Geen UI-/opslaglogica hier — enkel een niet-blokkerende waarschuwing in
 * `SettingsPanel.tsx` gebruikt dit.
 */

/**
 * `.app-title` is `font-size: var(--lt-font-size-lg)` (18px) met
 * `font-weight: 600` (index.css) — WCAG 1.4.3's "grote tekst"-uitzondering
 * (3:1 i.p.v. 4.5:1) geldt pas vanaf 24px normaal of 18.66px vetgedrukt
 * (font-weight ≥700); 18px/600 haalt geen van beide. Zowel `primaryColor`
 * als `accentColor` toetsen daarom aan dezelfde 4.5:1-tekstdrempel — geen
 * apart, lager "grotetekst"-threshold. Bevestigd door de bestaande
 * axe-core-runtime-baseline (a11y-axe.spec.ts, PR 8.2a), die een
 * `.app-title` onder 4.5:1 als "serious"-schending rapporteert.
 */
export const AA_TEXT_CONTRAST_THRESHOLD = 4.5;

/** Vaste kleuren waar `primaryColor`/`accentColor` in de lichte modus tegen
 * gerenderd worden — zie index.css/tokens.css. Bewust niet de
 * donkere-modus-varianten: die volgen `prefers-color-scheme` en zijn geen
 * vaste referentie om een teamkleur tegen te toetsen. */
export const PRIMARY_BUTTON_TEXT_COLOR = '#ffffff';
export const HEADER_BACKGROUND_COLOR = '#f9fafb';

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
 * ongeldige hex-kleur — de aanroeper behandelt dat als "geen waarschuwing
 * mogelijk", niet als een fout. */
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

export interface TeamColorContrastResult {
  primaryRatio: number;
  primaryOk: boolean;
  accentRatio: number;
  accentOk: boolean;
}

/** `primaryOk`/`accentOk` zijn `true` bij een ongeldige hex-kleur — geen
 * waarschuwing tonen over een kleur die `normalizeSettings`/
 * `applySettingUpdate` sowieso al zou hebben afgewezen/vervangen (zie
 * `HEX_COLOR_PATTERN` in `domain/settings/normalize.ts`). */
export function checkTeamColorContrast(
  primaryColor: string,
  accentColor: string,
): TeamColorContrastResult {
  const primaryRatio = contrastRatio(primaryColor, PRIMARY_BUTTON_TEXT_COLOR);
  const accentRatio = contrastRatio(accentColor, HEADER_BACKGROUND_COLOR);
  return {
    primaryRatio,
    primaryOk: primaryRatio === 0 || primaryRatio >= AA_TEXT_CONTRAST_THRESHOLD,
    accentRatio,
    accentOk: accentRatio === 0 || accentRatio >= AA_TEXT_CONTRAST_THRESHOLD,
  };
}
