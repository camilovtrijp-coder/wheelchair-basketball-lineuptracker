import { describe, it, expect } from 'vitest';
import {
  AA_TEXT_CONTRAST_THRESHOLD,
  checkTeamColorContrast,
  contrastRatio,
  hexToRgb,
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

  it('contrastRatio: #767676 tegen wit ligt net op de bekende AA-tekstgrens (~4.54:1)', () => {
    const ratio = contrastRatio('#767676', '#ffffff');
    expect(ratio).toBeGreaterThan(AA_TEXT_CONTRAST_THRESHOLD);
    expect(ratio).toBeCloseTo(4.5422, 3);
  });

  it('contrastRatio: geeft 0 terug bij een ongeldige hex-kleur', () => {
    expect(contrastRatio('niet-hex', '#ffffff')).toBe(0);
    expect(contrastRatio('#ffffff', 'niet-hex')).toBe(0);
  });

  it('checkTeamColorContrast: donkerblauwe primaire kleur haalt de AA-tekstdrempel op witte knoptekst', () => {
    const result = checkTeamColorContrast('#1e3a8a', '#000000');
    expect(result.primaryRatio).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    expect(result.primaryOk).toBe(true);
  });

  it('checkTeamColorContrast: felgeel als primaire kleur haalt de AA-tekstdrempel niet op witte knoptekst', () => {
    const result = checkTeamColorContrast('#ffff00', '#000000');
    expect(result.primaryRatio).toBeLessThan(AA_TEXT_CONTRAST_THRESHOLD);
    expect(result.primaryOk).toBe(false);
  });

  it('checkTeamColorContrast: zwart als accentkleur haalt de AA-tekstdrempel op de vaste headerachtergrond', () => {
    const result = checkTeamColorContrast('#ffffff', '#000000');
    expect(result.accentRatio).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    expect(result.accentOk).toBe(true);
  });

  it('checkTeamColorContrast: een lichtgele accentkleur haalt de AA-tekstdrempel niet op de vaste headerachtergrond', () => {
    const result = checkTeamColorContrast('#ffffff', '#fff8e1');
    expect(result.accentRatio).toBeLessThan(AA_TEXT_CONTRAST_THRESHOLD);
    expect(result.accentOk).toBe(false);
  });

  it('checkTeamColorContrast: accentColor toetst aan dezelfde 4.5:1-drempel als primaryColor (§8.2a-axe-baseline: .app-title is 18px/600, geen "grote tekst")', () => {
    // #f97316 (2.68:1 tegen #f9fafb) haalt de oude 3:1-"grotetekst"-drempel
    // wél, maar de echte 4.5:1-tekstdrempel niet — precies de regressie die
    // a11y-axe.spec.ts (PR 8.2a) op de echte DOM ving toen deze kleur
    // voorheen als default gold.
    const result = checkTeamColorContrast('#ffffff', '#f97316');
    expect(result.accentRatio).toBeCloseTo(2.68, 1);
    expect(result.accentOk).toBe(false);
  });

  it('checkTeamColorContrast: primaryRatio/accentRatio worden onafhankelijk tegen hun eigen vaste referentiekleur getoetst', () => {
    // primaryRatio toetst uitsluitend tegen PRIMARY_BUTTON_TEXT_COLOR
    // (#ffffff), niet tegen het tweede argument — een lichte accentkleur
    // mag de primaire uitkomst dus niet beïnvloeden.
    const withLightAccent = checkTeamColorContrast('#1e3a8a', '#fff8e1');
    const withDarkAccent = checkTeamColorContrast('#1e3a8a', '#000000');
    expect(withLightAccent.primaryRatio).toBeCloseTo(withDarkAccent.primaryRatio, 10);
  });

  it('checkTeamColorContrast: behandelt een ongeldige hex-kleur als geen waarschuwing (ratio 0, ok true)', () => {
    const result = checkTeamColorContrast('niet-hex', 'ook-niet-hex');
    expect(result.primaryRatio).toBe(0);
    expect(result.primaryOk).toBe(true);
    expect(result.accentRatio).toBe(0);
    expect(result.accentOk).toBe(true);
  });
});
