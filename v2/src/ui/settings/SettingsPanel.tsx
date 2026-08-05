import { useRef, useState } from 'preact/hooks';
import { LOGO_MAX_BYTES, type Settings } from '../../domain/settings/types';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import {
  getSettings,
  resetSettings,
  saveSettings,
  updateSetting,
} from '../../application/settings/usecases';
import type { SettingsRepository } from '../../application/settings/SettingsRepository';

const COLOR_PRESETS = [
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

export interface SettingsPanelProps {
  lang: Lang;
  repo: SettingsRepository;
  settings: Settings & Record<string, unknown>;
  onSettingsChange: (next: Settings & Record<string, unknown>) => void;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

export function SettingsPanel({ lang, repo, settings, onSettingsChange }: SettingsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleField<K extends keyof Settings>(field: K, value: Settings[K]) {
    const next = updateSetting(settings, field, value);
    onSettingsChange(next);
  }

  function handleLogoFile(file: File | undefined) {
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) {
      setError(t(lang, 'logoTooLargeError'));
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        handleField('logoUri', reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleReset() {
    const defaults = resetSettings(repo);
    onSettingsChange(defaults);
    setError(null);
  }

  function handleRefresh() {
    onSettingsChange(getSettings(repo));
    setError(null);
  }

  function handleSave() {
    const ok = saveSettings(repo, settings);
    setError(ok ? null : t(lang, 'settingsSaveError'));
  }

  const useClass = settings.useClassLimit === true;

  return (
    <section className="settings-panel" aria-label={t(lang, 'settingsTitle')}>
      <header className="settings-panel__header">
        <h2>{t(lang, 'settingsTitle')}</h2>
      </header>

      <fieldset className="settings-section">
        <legend>{t(lang, 'settingsSectionClub')}</legend>

        <label className="settings-field">
          <span className="settings-field__label">{t(lang, 'teamNameLabel')}</span>
          <input
            type="text"
            value={settings.teamName as string}
            data-testid="settings-teamName"
            onChange={(e) => handleField('teamName', (e.target as HTMLInputElement).value)}
          />
        </label>

        <div className="settings-field">
          <span className="settings-field__label">{t(lang, 'logoLabel')}</span>
          {settings.logoUri ? (
            <img
              src={settings.logoUri as string}
              alt=""
              className="settings-logo-preview"
              data-testid="settings-logo-preview"
            />
          ) : null}
          <div className="settings-logo-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style="display:none"
              data-testid="settings-logo-input"
              onChange={(e) =>
                handleLogoFile((e.target as HTMLInputElement).files?.[0] ?? undefined)
              }
            />
            <button
              type="button"
              className="btn-outline"
              onClick={() => fileInputRef.current?.click()}
            >
              {t(lang, 'logoChooseBtn')}
            </button>
            {settings.logoUri ? (
              <button
                type="button"
                className="btn-outline"
                onClick={() => handleField('logoUri', '')}
                data-testid="settings-logo-remove"
              >
                {t(lang, 'logoRemoveBtn')}
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-field">
          <span className="settings-field__label">{t(lang, 'primaryColorLabel')}</span>
          <ColorPickerRow
            value={settings.primaryColor as string}
            onChange={(c) => handleField('primaryColor', c)}
            testIdPrefix="primaryColor"
            customLabel={t(lang, 'customColorBtn')}
          />
        </div>

        <div className="settings-field">
          <span className="settings-field__label">{t(lang, 'accentColorLabel')}</span>
          <ColorPickerRow
            value={settings.accentColor as string}
            onChange={(c) => handleField('accentColor', c)}
            testIdPrefix="accentColor"
            customLabel={t(lang, 'customColorBtn')}
          />
        </div>
      </fieldset>

      <fieldset className="settings-section">
        <legend>{t(lang, 'settingsSectionMatch')}</legend>

        <label className="settings-field">
          <span className="settings-field__label">{t(lang, 'quarterCountLabel')}</span>
          <input
            type="number"
            min={1}
            max={12}
            step={1}
            value={settings.quarterCount as number}
            data-testid="settings-quarterCount"
            onChange={(e) => {
              const raw = Number((e.target as HTMLInputElement).value);
              handleField('quarterCount', raw);
            }}
          />
        </label>

        <label className="settings-field">
          <span className="settings-field__label">{t(lang, 'periodLabelLabel')}</span>
          <input
            type="text"
            placeholder={t(lang, 'quarterLabel')}
            value={settings.periodLabel as string}
            data-testid="settings-periodLabel"
            onChange={(e) => handleField('periodLabel', (e.target as HTMLInputElement).value)}
          />
        </label>
      </fieldset>

      <fieldset className="settings-section">
        <legend>{t(lang, 'settingsSectionClass')}</legend>

        <label className="settings-field settings-field--row">
          <input
            type="checkbox"
            checked={settings.useClassLimit as boolean}
            data-testid="settings-useClassLimit"
            onChange={(e) => handleField('useClassLimit', (e.target as HTMLInputElement).checked)}
          />
          <span className="settings-field__label">{t(lang, 'useClassLimitLabel')}</span>
        </label>

        {useClass ? (
          <>
            <p className="settings-explainer">{t(lang, 'classLimitExplain')}</p>

            <div className="settings-row">
              <label className="settings-field">
                <span className="settings-field__label">{t(lang, 'tag1LabelLabel')}</span>
                <input
                  type="text"
                  placeholder={t(lang, 'toggleTag1Default')}
                  value={settings.tag1Label as string}
                  data-testid="settings-tag1Label"
                  onChange={(e) => handleField('tag1Label', (e.target as HTMLInputElement).value)}
                />
                <small className="settings-hint">{t(lang, 'tag1LabelHint')}</small>
              </label>

              <label className="settings-field">
                <span className="settings-field__label">{t(lang, 'tag2LabelLabel')}</span>
                <input
                  type="text"
                  placeholder={t(lang, 'toggleTag2Default')}
                  value={settings.tag2Label as string}
                  data-testid="settings-tag2Label"
                  onChange={(e) => handleField('tag2Label', (e.target as HTMLInputElement).value)}
                />
                <small className="settings-hint">{t(lang, 'tag2LabelHint')}</small>
              </label>
            </div>

            <div className="settings-row">
              <label className="settings-field">
                <span className="settings-field__label">
                  {t(lang, 'classBaseLimitSettingLabel')}
                </span>
                <input
                  type="number"
                  step={0.1}
                  value={settings.classBaseLimit as number}
                  data-testid="settings-classBaseLimit"
                  onChange={(e) =>
                    handleField('classBaseLimit', Number((e.target as HTMLInputElement).value))
                  }
                />
              </label>
              <label className="settings-field">
                <span className="settings-field__label">{t(lang, 'maxBonusLabel')}</span>
                <input
                  type="number"
                  step={0.1}
                  value={settings.maxBonus as number}
                  data-testid="settings-maxBonus"
                  onChange={(e) =>
                    handleField('maxBonus', Number((e.target as HTMLInputElement).value))
                  }
                />
              </label>
            </div>

            <div className="settings-row">
              <label className="settings-field">
                <span className="settings-field__label">{t(lang, 'bonusTag1OnlyLabel')}</span>
                <input
                  type="number"
                  step={0.1}
                  value={settings.bonusTag1Only as number}
                  data-testid="settings-bonusTag1Only"
                  onChange={(e) =>
                    handleField('bonusTag1Only', Number((e.target as HTMLInputElement).value))
                  }
                />
              </label>
              <label className="settings-field">
                <span className="settings-field__label">{t(lang, 'bonusTag2OnlyLabel')}</span>
                <input
                  type="number"
                  step={0.1}
                  value={settings.bonusTag2Only as number}
                  data-testid="settings-bonusTag2Only"
                  onChange={(e) =>
                    handleField('bonusTag2Only', Number((e.target as HTMLInputElement).value))
                  }
                />
              </label>
              <label className="settings-field">
                <span className="settings-field__label">{t(lang, 'bonusBothLabel')}</span>
                <input
                  type="number"
                  step={0.1}
                  value={settings.bonusBoth as number}
                  data-testid="settings-bonusBoth"
                  onChange={(e) =>
                    handleField('bonusBoth', Number((e.target as HTMLInputElement).value))
                  }
                />
              </label>
            </div>
          </>
        ) : null}
      </fieldset>

      {error ? (
        <p className="settings-error" role="alert" data-testid="settings-error">
          {error}
        </p>
      ) : null}

      <div className="settings-actions">
        <button
          type="button"
          className="btn-primary"
          data-testid="settings-save"
          onClick={handleSave}
        >
          {t(lang, 'saveBtn')}
        </button>
        <button
          type="button"
          className="btn-outline"
          data-testid="settings-refresh"
          onClick={handleRefresh}
        >
          ↻
        </button>
        <button
          type="button"
          className="btn-outline"
          data-testid="settings-reset"
          onClick={handleReset}
        >
          {t(lang, 'settingsResetBtn')}
        </button>
      </div>
    </section>
  );
}

interface ColorPickerRowProps {
  value: string;
  onChange: (value: string) => void;
  testIdPrefix: string;
  customLabel: string;
}

function ColorPickerRow({ value, onChange, testIdPrefix, customLabel }: ColorPickerRowProps) {
  const ref = useRef<HTMLInputElement | null>(null);
  const current = String(value || '').toLowerCase();
  return (
    <div className="color-picker-row">
      {COLOR_PRESETS.map((c) => {
        const selected = c.toLowerCase() === current;
        return (
          <button
            key={c}
            type="button"
            className={`swatch${selected ? ' swatch--selected' : ''}`}
            style={`background:${c}`}
            aria-label={c}
            aria-pressed={selected}
            data-testid={`${testIdPrefix}-${c.slice(1)}`}
            onClick={() => onChange(c)}
          />
        );
      })}
      <button
        type="button"
        className="btn-outline"
        data-testid={`${testIdPrefix}-custom`}
        onClick={() => ref.current?.click()}
      >
        {customLabel}
      </button>
      <input
        ref={ref}
        type="color"
        style="display:none"
        value={value}
        data-testid={`${testIdPrefix}-native`}
        onChange={(e) => onChange((e.target as HTMLInputElement).value)}
      />
    </div>
  );
}
