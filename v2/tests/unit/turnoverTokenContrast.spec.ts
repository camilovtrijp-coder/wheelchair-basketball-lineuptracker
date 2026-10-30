import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  AA_TEXT_CONTRAST_THRESHOLD,
  contrastRatio,
  hexToRgb,
} from '../../src/domain/settings/colorContrast';

// Contrast van de turnover-kleuren (turnovers.css) in beide thema's, berekend uit
// tokens.css. Gemengde vlakken volgen `color-mix(in srgb, kleur P%, basis)`.
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

describe.each(Object.keys(THEMES))('turnovers: contrast (%s thema)', (theme) => {
  const t = THEMES[theme]!;

  it('knoptekst op de turnoverknop', () => {
    expect(contrastRatio(t['turnover-fg']!, t.turnover!)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });

  it('getal in het tellervak (tekst op getint vlak)', () => {
    expect(contrastRatio(t.fg!, mix(t.turnover!, 22, t.bg!))).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });

  it('TO-pil: turnoverkleur op getint vlak', () => {
    expect(contrastRatio(t.turnover!, mix(t.turnover!, 16, t.surface!))).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });

  it('totaalregel in Historie: turnoverkleur (vet) op getint vlak', () => {
    expect(contrastRatio(t.turnover!, mix(t.turnover!, 12, t.surface!))).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });

  it('segmentteller: turnoverkleur op de kaartachtergrond', () => {
    expect(contrastRatio(t.turnover!, t.surface!)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });
});
