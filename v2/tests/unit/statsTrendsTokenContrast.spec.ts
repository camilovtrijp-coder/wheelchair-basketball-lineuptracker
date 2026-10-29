import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AA_TEXT_CONTRAST_THRESHOLD,
  contrastRatio,
  hexToRgb,
} from '../../src/domain/settings/colorContrast';

// Bewaakt de kleurparen van Stats en Trends (src/styles/stats-trends.css) in
// beide thema's rechtstreeks op de tokens, zonder browser: tekst op de pillen
// ≥4.5:1, grafiekkleuren (niet-tekst) ≥3:1.
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

describe.each(THEMES)('Stats/Trends-kleurparen: %s', (_name, t) => {
  it('heeft alle benodigde tokens', () => {
    for (const key of [
      'success',
      'danger',
      'muted',
      'fg',
      'surface',
      'surface-alt',
      'accent',
      'teal',
      'on-success',
      'on-danger',
    ]) {
      expect(t[key], key).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('+/--pillen: tekst haalt 4.5:1 op de eigen pilachtergrond', () => {
    const pos = mix(t.success!, 14, t.surface!);
    const neg = mix(t.danger!, 14, t.surface!);
    expect(contrastRatio(t.success!, pos)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    expect(contrastRatio(t.danger!, neg)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    expect(contrastRatio(t.muted!, t.surface!)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    expect(contrastRatio(t.muted!, t['surface-alt']!)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });

  it('actieve filterknop en gevulde spelersfilterknoppen halen 4.5:1', () => {
    const active = mix(t.accent!, 18, t.surface!);
    expect(contrastRatio(t.fg!, active)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    expect(contrastRatio(t['on-success']!, t.success!)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
    expect(contrastRatio(t['on-danger']!, t.danger!)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });

  it('grafiekkleuren (lijn, punten, staven) halen 3:1 op de kaart', () => {
    for (const key of ['success', 'danger', 'teal']) {
      expect(contrastRatio(t[key]!, t.surface!), key).toBeGreaterThanOrEqual(3);
    }
  });
});
