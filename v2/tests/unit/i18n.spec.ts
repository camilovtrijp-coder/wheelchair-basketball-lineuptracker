import { describe, it, expect, beforeEach } from 'vitest';
import {
  LANG_STORAGE_KEY,
  STRINGS,
  SUPPORTED_LANGS,
  isValidLang,
  translate,
} from '../../src/i18n/strings';
import { readLang, writeLang, clearLang, type KeyValueStorage } from '../../src/i18n/persistence';
import { detectInitialLang, resolveInitialLang } from '../../src/i18n/detect';

class TrackingStorage implements KeyValueStorage {
  private store = new Map<string, string>();
  public readonly accessedKeys: string[] = [];
  public readonly writtenKeys: string[] = [];
  public readonly removedKeys: string[] = [];

  getItem(key: string): string | null {
    this.accessedKeys.push(key);
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writtenKeys.push(key);
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.removedKeys.push(key);
    this.store.delete(key);
  }

  seed(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('i18n/strings', () => {
  it('kent precies nl en en', () => {
    expect(SUPPORTED_LANGS).toEqual(['nl', 'en']);
  });

  it('isValidLang herkent geldige en ongeldige waarden', () => {
    expect(isValidLang('nl')).toBe(true);
    expect(isValidLang('en')).toBe(true);
    expect(isValidLang('de')).toBe(false);
    expect(isValidLang('')).toBe(false);
    expect(isValidLang(null)).toBe(false);
    expect(isValidLang(undefined)).toBe(false);
    expect(isValidLang(42)).toBe(false);
  });

  it('STRINGS bevat dezelfde keys voor nl en en', () => {
    expect(Object.keys(STRINGS.nl).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  it('translate levert de juiste string per taal', () => {
    expect(translate('nl', 'appHeading')).toBe('v2 leeg');
    expect(translate('en', 'appHeading')).toBe('v2 empty');
    expect(translate('nl', 'switchToEn')).toBe('Schakel naar Engels');
    expect(translate('en', 'switchToEn')).toBe('Switch to English');
  });
});

describe('i18n/detect', () => {
  it('kiest nl als geen navigator-taal is gezet', () => {
    expect(detectInitialLang()).toBe('nl');
  });

  it('kiest nl voor niet-Engelse talen', () => {
    expect(detectInitialLang('nl-NL')).toBe('nl');
    expect(detectInitialLang('fr-FR')).toBe('nl');
    expect(detectInitialLang('de-DE')).toBe('nl');
  });

  it('kiest en voor Engels-achtige talen', () => {
    expect(detectInitialLang('en')).toBe('en');
    expect(detectInitialLang('en-US')).toBe('en');
    expect(detectInitialLang('EN-GB')).toBe('en');
  });

  it('resolveInitialLang gebruikt opgeslagen taal indien geldig', () => {
    expect(resolveInitialLang('nl-NL', 'en')).toBe('en');
    expect(resolveInitialLang('en-US', 'nl')).toBe('nl');
  });

  it('resolveInitialLang valt terug op detectie bij ontbrekende of ongeldige opslag', () => {
    expect(resolveInitialLang('en-US', null)).toBe('en');
    expect(resolveInitialLang('en-US', undefined)).toBe('en');
    expect(resolveInitialLang('en-US', 'fr')).toBe('en');
    expect(resolveInitialLang('nl-NL', 'fr')).toBe('nl');
    expect(resolveInitialLang(undefined, null)).toBe('nl');
  });
});

describe('i18n/persistence — alleen `lineup-tracker-lang`', () => {
  let storage: TrackingStorage;

  beforeEach(() => {
    storage = new TrackingStorage();
  });

  it('readLang schrijft niets en leest alleen de gedeelde v1-key', () => {
    storage.seed(LANG_STORAGE_KEY, 'en');
    expect(readLang(storage)).toBe('en');
    expect(storage.accessedKeys).toEqual([LANG_STORAGE_KEY]);
    expect(storage.writtenKeys).toEqual([]);
    expect(storage.removedKeys).toEqual([]);
  });

  it('readLang geeft null terug als er niets is opgeslagen', () => {
    expect(readLang(storage)).toBeNull();
    expect(storage.accessedKeys).toEqual([LANG_STORAGE_KEY]);
  });

  it('readLang geeft null terug bij een corrupte waarde', () => {
    storage.seed(LANG_STORAGE_KEY, 'fr');
    expect(readLang(storage)).toBeNull();
  });

  it('writeLang raakt uitsluitend de gedeelde v1-key en niets anders', () => {
    writeLang(storage, 'en');
    expect(storage.writtenKeys).toEqual([LANG_STORAGE_KEY]);
    expect(storage.accessedKeys).toEqual([]);
    expect(storage.removedKeys).toEqual([]);
  });

  it('writeLang + readLang roundtrip herstelt dezelfde taal', () => {
    writeLang(storage, 'en');
    expect(readLang(storage)).toBe('en');
    writeLang(storage, 'nl');
    expect(readLang(storage)).toBe('nl');
    expect(storage.writtenKeys).toEqual([LANG_STORAGE_KEY, LANG_STORAGE_KEY]);
    expect(storage.removedKeys).toEqual([]);
  });

  it('clearLang verwijdert alleen de gedeelde v1-key', () => {
    storage.seed(LANG_STORAGE_KEY, 'en');
    clearLang(storage);
    expect(storage.removedKeys).toEqual([LANG_STORAGE_KEY]);
    expect(readLang(storage)).toBeNull();
  });
});
