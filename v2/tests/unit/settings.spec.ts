import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import {
  validateSettings,
  isPlainObject,
  type SettingsValidationError,
} from '../../src/domain/settings/validation';
import { normalizeSettings, applySettingUpdate } from '../../src/domain/settings/normalize';

function validSettings(): Settings & Record<string, unknown> {
  return { ...DEFAULT_SETTINGS };
}

describe('domain/settings/validation', () => {
  it('isPlainObject herkent plain objects en wijst andere waarden af', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject('s')).toBe(false);
    expect(isPlainObject(1)).toBe(false);
  });

  it('validateSettings accepteert een geldig v1-settings object', () => {
    expect(validateSettings(validSettings())).toEqual([]);
  });

  it('validateSettings wijst een niet-object af', () => {
    const errors = validateSettings(null);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('settingsNotObject');
  });

  it('validateSettings meldt ontbrekende velden', () => {
    const partial = { ...validSettings() } as Record<string, unknown>;
    delete partial['teamName'];
    delete partial['quarterCount'];
    const errors = validateSettings(partial);
    const codes = errors.map((e) => `${e.code}:${e.field ?? ''}`).sort();
    expect(codes).toContain('settingsFieldMissing:teamName');
    expect(codes).toContain('settingsFieldMissing:quarterCount');
  });

  it('validateSettings meldt verkeerde typen voor boolean- en number-velden', () => {
    const bad = {
      ...validSettings(),
      useClassLimit: 'ja',
      quarterCount: '4',
    } as unknown as Settings;
    const errors: SettingsValidationError[] = validateSettings(bad);
    const codes = errors.map((e) => `${e.code}:${e.field ?? ''}`).sort();
    expect(codes).toContain('settingsFieldTypeBoolean:useClassLimit');
    expect(codes).toContain('settingsFieldTypeNumber:quarterCount');
  });
});

describe('domain/settings/normalize', () => {
  it('vult ontbrekende defaults aan maar muteert bestaande waarden niet', () => {
    const v1 = { teamName: 'A', quarterCount: 3 } as Record<string, unknown>;
    const out = normalizeSettings(v1);
    expect(out.teamName).toBe('A');
    expect(out.quarterCount).toBe(3);
    expect(out.primaryColor).toBe(DEFAULT_SETTINGS.primaryColor);
    expect(out.useClassLimit).toBe(DEFAULT_SETTINGS.useClassLimit);
  });

  it('behoudt onbekende keys bij read en write (geen stille vormwijziging)', () => {
    const v1 = {
      teamName: 'A',
      toekomstigVeld: { nested: true },
      arrayVeld: [1, 2, 3],
    } as unknown as Settings;
    const out = normalizeSettings(v1);
    expect((out as Record<string, unknown>)['toekomstigVeld']).toEqual({ nested: true });
    expect((out as Record<string, unknown>)['arrayVeld']).toEqual([1, 2, 3]);
  });

  it('retourneert zuivere defaults bij niet-object input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('string')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it('retourneert defaults bij corrupte JSON-vorm maar behoudt structuur', () => {
    expect(normalizeSettings({ not: 'a settings object' })).toEqual({
      ...DEFAULT_SETTINGS,
      not: 'a settings object',
    });
  });

  it('applySettingUpdate clampt quarterCount en coerceert types', () => {
    const start = validSettings();
    const next1 = applySettingUpdate(start, 'quarterCount', 99);
    expect(next1.quarterCount).toBe(12);
    const next2 = applySettingUpdate(start, 'quarterCount', 0);
    expect(next2.quarterCount).toBe(1);
    const next3 = applySettingUpdate(start, 'quarterCount', '7' as unknown as number);
    expect(next3.quarterCount).toBe(7);
  });

  it('applySettingUpdate laat onbekende keys ongemoeid', () => {
    const start = {
      ...validSettings(),
      toekomstigVeld: 'bewaard',
    } as Settings & Record<string, unknown>;
    const next = applySettingUpdate(start, 'teamName', 'B');
    expect(next.teamName).toBe('B');
    expect((next as Record<string, unknown>)['toekomstigVeld']).toBe('bewaard');
  });

  it('applySettingUpdate accepteert ongeldige input-types door te vallen op de huidige waarde', () => {
    const start = validSettings();
    const next = applySettingUpdate(start, 'useClassLimit', 'ja' as unknown as boolean);
    expect(next.useClassLimit).toBe(start.useClassLimit);
  });

  it('applySettingUpdate accepteert een ongeldige hex-kleur door te vallen op de huidige', () => {
    const start = validSettings();
    const next = applySettingUpdate(start, 'primaryColor', 'not-a-color');
    expect(next.primaryColor).toBe(start.primaryColor);
  });
});
