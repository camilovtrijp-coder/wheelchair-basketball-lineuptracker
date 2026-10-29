import { describe, it, expect } from 'vitest';
import {
  AA_TEXT_CONTRAST_THRESHOLD,
  contrastRatio,
  deriveButtonForeground,
} from '../../src/domain/settings/colorContrast';

// Zelfde tien presets als COLOR_PRESETS in ui/settings/SettingsPanel.tsx.
const PRESETS = [
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
];

describe('score-/wisselknoppen: leesbare tekst op de teamkleur (stap 2)', () => {
  it.each(PRESETS)('preset %s: afgeleide knoptekst haalt AA (4.5:1)', (hex) => {
    const fg = deriveButtonForeground(hex);
    expect(contrastRatio(fg, hex)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
  });

  it('tegenstanderkleur: vast oranje (#f97316) met zwarte tekst haalt AA', () => {
    expect(contrastRatio('#000000', '#f97316')).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST_THRESHOLD);
  });
});
