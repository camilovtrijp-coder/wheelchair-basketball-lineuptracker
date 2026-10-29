import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  AA_TEXT_CONTRAST_THRESHOLD,
  contrastRatio,
  hexToRgb,
} from '../../src/domain/settings/colorContrast';

// Contrast van de kleurparen in team-setup.css (Team, wedstrijdopzet, segmentkaart),
// berekend uit de tokens in tokens.css voor beide thema's. Het gemengde vlak is
// `color-mix(in srgb, kleur P%, surface)` zoals in de CSS.
const tokensCss = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');

function readTokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--lt-color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

const lightStart = tokensCss.indexOf(":root[data-theme='light']");
const THEMES: Record<string, Record<string, string>> = {
  donker: readTokens(tokensCss.slice(0, lightStart)),
  licht: {
    ...readTokens(tokensCss.slice(0, lightStart)),
    ...readTokens(tokensCss.slice(lightStart)),
  },
};

function mix(colorHex: string, percent: number, baseHex: string): string {
  const c = hexToRgb(colorHex)!;
  const b = hexToRgb(baseHex)!;
  const ch = (x: number, y: number) =>
    Math.round((x * percent) / 100 + (y * (100 - percent)) / 100)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(c.r, b.r)}${ch(c.g, b.g)}${ch(c.b, b.b)}`;
}

describe.each(Object.keys(THEMES))('team/opzet/segment: contrast (%s thema)', (theme) => {
  const t = THEMES[theme]!;

  it('Meedoen actief: groen op groen getint vlak', () => {
    expect(contrastRatio(t.success!, mix(t.success!, 16, t.surface!))).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });

  it.each(['tag1', 'tag2'])('classificatie %s actief: kleur op getint vlak', (tag) => {
    expect(contrastRatio(t[tag]!, mix(t[tag]!, 16, t.surface!))).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });

  it('Start actief: accent-tekst op effen accent', () => {
    expect(contrastRatio(t['accent-fg']!, t.accent!)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });

  it('Segment opslaan: success-fg op groen', () => {
    expect(contrastRatio(t['success-fg']!, t.success!)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });

  it('actief kwart: tekst op getint accentvlak', () => {
    expect(contrastRatio(t.fg!, mix(t.accent!, 18, t.surface!))).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });

  it('inputtekst en placeholder op surface-alt', () => {
    expect(contrastRatio(t.fg!, t['surface-alt']!)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
    expect(contrastRatio(t.muted!, t['surface-alt']!)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });
});
