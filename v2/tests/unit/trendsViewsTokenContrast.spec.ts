import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AA_TEXT_CONTRAST_THRESHOLD,
  contrastRatio,
  hexToRgb,
} from '../../src/domain/settings/colorContrast';

// Contrast van de kleurparen in src/styles/trends-views.css (T2/T3) in beide
// thema's, rechtstreeks op de tokens. Groen/rood blijven (besluit eigenaar);
// de symbolen en tekst in de markup zijn de echte dragers van de betekenis,
// dit bewaakt dat de kleuren ook zelf leesbaar blijven.
const TOKENS_CSS = readFileSync(resolve(__dirname, '../../src/styles/tokens.css'), 'utf8');

function readTokens(selectorStart: string): Record<string, string> {
  const start = TOKENS_CSS.indexOf(selectorStart);
  const end = TOKENS_CSS.indexOf('}', start);
  const tokens: Record<string, string> = {};
  for (const m of TOKENS_CSS.slice(start, end).matchAll(
    /--lt-color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/g,
  )) {
    tokens[m[1]!] = m[2]!;
  }
  return tokens;
}

function mix(fg: string, pct: number, bg: string): string {
  const a = hexToRgb(fg)!;
  const b = hexToRgb(bg)!;
  const ch = (x: number, y: number) =>
    Math.round((x * pct) / 100 + (y * (100 - pct)) / 100)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(a.r, b.r)}${ch(a.g, b.g)}${ch(a.b, b.b)}`;
}

const dark = readTokens(':root {');
const THEMES: Array<[string, Record<string, string>]> = [
  ['donker (standaard)', dark],
  ['licht', { ...dark, ...readTokens(":root[data-theme='light'] {") }],
];

describe.each(THEMES)('Trends-weergaven: kleurparen (%s)', (_name, t) => {
  it('toonwaarden (groen/rood/grijs) als tekst op de kaart halen 4.5:1', () => {
    for (const key of ['success', 'danger', 'muted']) {
      expect(contrastRatio(t[key]!, t.surface!), key).toBeGreaterThanOrEqual(
        AA_TEXT_CONTRAST_THRESHOLD,
      );
    }
  });

  it('gedempte tekst (uitleg, notitie, Te weinig data) haalt 4.5:1 op de pagina en de kaart', () => {
    expect(contrastRatio(t.muted!, t.bg!)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    expect(contrastRatio(t.muted!, t.surface!)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
  });

  it('tabs en metriekknoppen: tekst haalt 4.5:1 (actief, inactief)', () => {
    expect(contrastRatio(t.fg!, mix(t.accent!, 18, t.surface!))).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
    expect(contrastRatio(t.muted!, t.surface!)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    expect(contrastRatio(t.fg!, t['surface-alt']!)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST_THRESHOLD,
    );
  });

  it('balken (niet-tekst) halen 3:1 op het spoor; focusring haalt 3:1 op de pagina', () => {
    for (const key of ['success', 'danger', 'muted']) {
      expect(contrastRatio(t[key]!, t['surface-alt']!), key).toBeGreaterThanOrEqual(3);
    }
    expect(contrastRatio(t.focus!, t.bg!)).toBeGreaterThanOrEqual(3);
  });

  it('waarschuwing: tekst op de kaart en de rode rand halen de drempels', () => {
    expect(contrastRatio(t.fg!, t.surface!)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
    expect(contrastRatio(t.danger!, t.surface!)).toBeGreaterThanOrEqual(3);
  });
});
