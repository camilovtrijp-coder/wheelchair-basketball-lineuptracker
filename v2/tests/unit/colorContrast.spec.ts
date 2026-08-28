import { describe, it, expect } from 'vitest';
import {
  AA_TEXT_CONTRAST_THRESHOLD,
  HEADER_BACKGROUND_DARK,
  HEADER_BACKGROUND_LIGHT,
  contrastRatio,
  deriveAccentForeground,
  deriveButtonForeground,
  hexToRgb,
  pickReadableColor,
} from '../../src/domain/settings/colorContrast';

describe('domain/settings/colorContrast', () => {
  it('hexToRgb parseert een geldige hex-kleur en wijst een ongeldige af', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#2563EB')).toEqual({ r: 37, g: 99, b: 235 });
    expect(hexToRgb('geen-kleur')).toBeNull();
    expect(hexToRgb('#fff')).toBeNull();
    expect(hexToRgb('')).toBeNull();
  });

  it('contrastRatio: zwart-op-wit geeft de maximale WCAG-ratio van 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('contrastRatio: identieke kleuren geven een ratio van 1:1', () => {
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#2563eb', '#2563eb')).toBeCloseTo(1, 5);
  });

  it('contrastRatio: is symmetrisch in de kleurvolgorde', () => {
    expect(contrastRatio('#2563eb', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#2563eb'),
      10,
    );
  });

  it('contrastRatio: geeft 0 terug bij een ongeldige hex-kleur', () => {
    expect(contrastRatio('niet-hex', '#ffffff')).toBe(0);
    expect(contrastRatio('#ffffff', 'niet-hex')).toBe(0);
  });

  it('pickReadableColor: kiest de eerste kandidaat die de drempel haalt', () => {
    // #1e3a8a (donkerblauw) haalt ruim 4.5:1 tegen wit — de eerste kandidaat
    // in de lijst wint, ook al zou zwart een hogere ratio geven.
    expect(pickReadableColor(['#1e3a8a', '#000000'], '#ffffff')).toBe('#1e3a8a');
  });

  it('pickReadableColor: valt terug op de kandidaat met de hoogste ratio als niemand de drempel haalt', () => {
    // Tegen achtergrond #808080 geeft #707070 een ratio van ~1.25:1 en
    // #606060 ~1.59:1 — geen van beide haalt de (hier kunstmatig hoge)
    // drempel van 100, dus #606060 (de hoogste) wint.
    expect(pickReadableColor(['#707070', '#606060'], '#808080', 100)).toBe('#606060');
  });

  it('pickReadableColor: geeft nooit undefined terug, ook niet met een lege kandidatenlijst', () => {
    expect(pickReadableColor([], '#ffffff')).toBe('#000000');
  });

  it('deriveButtonForeground: kiest wit op een donkere primaire kleur', () => {
    expect(deriveButtonForeground('#1e3a8a')).toBe('#ffffff');
  });

  it('deriveButtonForeground: kiest zwart op een lichte primaire kleur', () => {
    expect(deriveButtonForeground('#ffff00')).toBe('#000000');
  });

  it('deriveButtonForeground: garandeert ≥4.5:1 contrast voor een reeks primaire kleuren, ongeacht kleurenschema', () => {
    // Bewijst het wiskundige argument in colorContrast.ts: max(contrast
    // tegen wit, contrast tegen zwart) ≥ 4.5:1 voor elke achtergrondkleur —
    // dus de knopachtergrond zelf (die niet wisselt met het kleurenschema)
    // maakt hier geen apart licht/donker-onderscheid nodig.
    const primaryColorSwatches = [
      '#22c55e',
      '#10b981',
      '#0ea5e9',
      '#3b82f6',
      '#8b5cf6',
      '#ec4899',
      '#f59e0b',
      '#f97316',
      '#ef4444',
      '#14b8a6',
      '#2563eb',
      '#000000',
      '#ffffff',
      '#808080',
    ];
    for (const swatch of primaryColorSwatches) {
      const fg = deriveButtonForeground(swatch);
      expect(contrastRatio(fg, swatch)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    }
  });

  it('deriveAccentForeground: behoudt de gekozen accentkleur wanneer die zelf al voldoende contrast geeft', () => {
    // #000000 tegen de lichte headerachtergrond haalt ruim 4.5:1 — geen
    // terugval naar wit/zwart nodig (zwart IS al de eerste kandidaat, dus
    // dit bewijst vooral dat de functie 'm niet onnodig vervangt).
    expect(deriveAccentForeground('#000000', HEADER_BACKGROUND_LIGHT)).toBe('#000000');
  });

  it('deriveAccentForeground: valt terug op wit wanneer de gekozen accentkleur onvoldoende contrast geeft tegen de DONKERE headerachtergrond (de PR #83-regressie)', () => {
    // #c2410c (DEFAULT_SETTINGS.accentColor) haalt 4.96:1 tegen de LICHTE
    // headerachtergrond (dus als tekstkleur behouden — zie de vorige test),
    // maar slechts 3.43:1 tegen de DONKERE headerachtergrond: precies de
    // dark-mode-P1-bevinding uit de review op PR #83, die de eerdere
    // waarschuwing (die alleen de lichte modus toetste) niet kon zien.
    const ratioDark = contrastRatio('#c2410c', HEADER_BACKGROUND_DARK);
    expect(ratioDark).toBeLessThan(AA_TEXT_CONTRAST_THRESHOLD);
    expect(deriveAccentForeground('#c2410c', HEADER_BACKGROUND_DARK)).toBe('#ffffff');
  });

  it('deriveAccentForeground: garandeert ≥4.5:1 contrast tegen zowel de lichte als de donkere headerachtergrond', () => {
    // De exacte PR #83-regressie: DEFAULT_SETTINGS.accentColor tegen de
    // DONKERE headerachtergrond (#c2410c op #111827 = 3.43:1, gerapporteerd
    // in de review) moet nu via de afgeleide voorgrond alsnog voldoen.
    const accentColorSwatches = ['#c2410c', '#f97316', '#22c55e', '#ffffff', '#000000', '#808080'];
    for (const swatch of accentColorSwatches) {
      const fgLight = deriveAccentForeground(swatch, HEADER_BACKGROUND_LIGHT);
      expect(contrastRatio(fgLight, HEADER_BACKGROUND_LIGHT)).toBeGreaterThanOrEqual(
        AA_TEXT_CONTRAST_THRESHOLD,
      );
      const fgDark = deriveAccentForeground(swatch, HEADER_BACKGROUND_DARK);
      expect(contrastRatio(fgDark, HEADER_BACKGROUND_DARK)).toBeGreaterThanOrEqual(
        AA_TEXT_CONTRAST_THRESHOLD,
      );
    }
  });
});
