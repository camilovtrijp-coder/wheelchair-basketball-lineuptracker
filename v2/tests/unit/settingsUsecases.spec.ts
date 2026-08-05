import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { SettingsRepository } from '../../src/application/settings/SettingsRepository';
import {
  getSettings,
  resetSettings,
  saveSettings,
  updateSetting,
} from '../../src/application/settings/usecases';

type SettingsLike = Settings & Record<string, unknown>;

class TrackingRepository implements SettingsRepository {
  public writeCalls: SettingsLike[] = [];
  public writeResult = true;
  private current: SettingsLike;

  constructor(initial: SettingsLike = { ...DEFAULT_SETTINGS }) {
    this.current = initial;
  }

  read(): SettingsLike {
    return this.current;
  }

  write(settings: SettingsLike): boolean {
    this.writeCalls.push(settings);
    if (this.writeResult) this.current = settings;
    return this.writeResult;
  }

  reset(): SettingsLike {
    this.current = { ...DEFAULT_SETTINGS };
    this.write(this.current);
    return this.current;
  }
}

describe('application/settings/usecases', () => {
  it('updateSetting past het veld toe in het geheugen zonder te persisteren', () => {
    const repo = new TrackingRepository();
    const current = { ...DEFAULT_SETTINGS };
    const next = updateSetting(current, 'teamName', 'Nieuwe naam');

    expect(next.teamName).toBe('Nieuwe naam');
    expect(repo.writeCalls).toEqual([]);
  });

  it('saveSettings schrijft expliciet naar de repository en geeft het resultaat door', () => {
    const repo = new TrackingRepository();
    const next = { ...DEFAULT_SETTINGS, teamName: 'Opgeslagen' };

    expect(saveSettings(repo, next)).toBe(true);
    expect(repo.writeCalls).toEqual([next]);

    repo.writeResult = false;
    expect(saveSettings(repo, next)).toBe(false);
  });

  it('getSettings en resetSettings delegeren naar de repository', () => {
    const repo = new TrackingRepository({ ...DEFAULT_SETTINGS, teamName: 'X' });
    expect(getSettings(repo).teamName).toBe('X');

    const reset = resetSettings(repo);
    expect(reset).toEqual(DEFAULT_SETTINGS);
  });
});
