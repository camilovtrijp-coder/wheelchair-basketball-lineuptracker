// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  parseTheme,
  readStoredTheme,
  storeTheme,
} from '../../src/infrastructure/theme/theme';

describe('theme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('parseTheme: alleen "light" geeft licht, al het andere is donker (standaard)', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme(null)).toBe('dark');
    expect(parseTheme(undefined)).toBe('dark');
    expect(parseTheme('Light')).toBe('dark');
    expect(parseTheme('rommel')).toBe('dark');
  });

  it('zonder opgeslagen keuze is het thema donker', () => {
    expect(readStoredTheme()).toBe('dark');
  });

  it('storeTheme en readStoredTheme: roundtrip onder één eigen key', () => {
    storeTheme('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(readStoredTheme()).toBe('light');
    storeTheme('dark');
    expect(readStoredTheme()).toBe('dark');
    expect(window.localStorage.length).toBe(1);
  });

  it('applyTheme zet data-theme op <html>', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('een falende storage valt stil terug op donker en gooit niet bij schrijven', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(readStoredTheme()).toBe('dark');
      expect(() => storeTheme('light')).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
