import {
  DEFAULT_SETTINGS,
  SETTINGS_BOOLEAN_KEYS,
  SETTINGS_KEYS,
  SETTINGS_NUMBER_KEYS,
  type Settings,
  type SettingsKey,
} from './types';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface SettingsValidationError {
  code:
    | 'settingsNotObject'
    | 'settingsFieldMissing'
    | 'settingsFieldTypeBoolean'
    | 'settingsFieldTypeNumber';
  field?: SettingsKey;
  details?: Record<string, unknown>;
}

export function validateSettings(value: unknown): SettingsValidationError[] {
  const errors: SettingsValidationError[] = [];

  if (!isPlainObject(value)) {
    errors.push({ code: 'settingsNotObject' });
    return errors;
  }

  for (const k of SETTINGS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, k)) {
      errors.push({ code: 'settingsFieldMissing', field: k });
    }
  }

  for (const bk of SETTINGS_BOOLEAN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, bk) && typeof value[bk] !== 'boolean') {
      errors.push({ code: 'settingsFieldTypeBoolean', field: bk });
    }
  }

  for (const nk of SETTINGS_NUMBER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, nk) && typeof value[nk] !== 'number') {
      errors.push({ code: 'settingsFieldTypeNumber', field: nk });
    }
  }

  return errors;
}

export function hasErrors(errors: SettingsValidationError[]): boolean {
  return errors.length > 0;
}

export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS };
}
