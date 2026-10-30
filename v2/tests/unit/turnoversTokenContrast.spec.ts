import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AA_TEXT_CONTRAST_THRESHOLD,
  contrastRatio,
  hexToRgb,
} from '../../src/domain/settings/colorContrast';

// Bewaakt de kleurparen van de turnover-onderdelen (src/styles/turnovers-analysis.css)
// in beide thema's rechtstreeks op de tokens: tekst ≥4.5:1, staafkleuren ≥3:1.
const TOKENS_CSS = readFileSync(resolve(__dirname, '../../src/styles/tokens.css'), 'utf8');

function readTokens(selectorStart: string): Record<string, string> {
  const start = TOKENS_CSS.indexOf(selectorStart);
  const end = TOKENS_CSS.indexOf('}', start);
  const block = TOKENS_CSS.slice(start, end);
  const tokens: Record<string, string> = {};
  for (const m of block.matchAll(/--lt-color-([a-z-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    tokens[m[1]!] = m[2]!;
  }
  return tokens;
}

/** `color-mix(in srgb, fg pct%, bg)` voor twee hexkleuren, als hex. */
function mix(fg: string, pct: number, bg: string): string {
  const a = hexToRgb(fg)!;
  const b = hexToRgb(bg)!;
  const ch = (x: number, y: number) =>
    Math.round((x * pct) / 100 + (y * (100 - pct)) / 100)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(a.r, b.r)}${ch(a.g, b.g)}${ch(a.b, b.b)}`;
}

const THEMES: Array<[string, Record<string, string>]> = [
  ['donker (standaard)', readTokens(':root {')],
  ['licht', readTokens(":root[data-theme='light'] {")],
];

describe.each(THEMES)('Turnover-kleurparen: %s', (_name, t) => {
  it('pillen: goed/slecht-tekst haalt 4.5:1 op de eigen pilachtergrond, neutraal op surface-alt', () => {
    const good = mix(t.success!, 14, t.surface!);
    const bad = mix(t.danger!, 14, t.surface!);
    expect(contrastRatio(t.success!, good)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    expect(contrastRatio(t.danger!, bad)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    expect(contrastRatio(t.muted!, t['surface-alt']!)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });

  it('tegels: label (muted) en turnovergetal (danger) halen 4.5:1 op de tegelachtergrond', () => {
    expect(contrastRatio(t.muted!, t.bg!)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    expect(contrastRatio(t.danger!, t.bg!)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
  });

  it('totaalregel: getal (danger) haalt 4.5:1 op de rode kaartachtergrond', () => {
    const banner = mix(t.danger!, 12, t.surface!);
    expect(contrastRatio(t.danger!, banner)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    expect(contrastRatio(t.fg!, banner)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
  });

  it('lineup-kaart: waardes halen 4.5:1 op de kaart, staafvullingen 3:1 op het spoor', () => {
    expect(contrastRatio(t.success!, t.surface!)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
    expect(contrastRatio(t.danger!, t.surface!)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    for (const key of ['success', 'danger']) {
      expect(contrastRatio(t[key]!, t['surface-alt']!), key).toBeGreaterThanOrEqual(3);
    }
  });
});
