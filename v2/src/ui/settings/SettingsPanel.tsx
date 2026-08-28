import { useRef } from 'preact/hooks';
import { LOGO_MAX_BYTES, type Settings, type SettingsKey } from '../../domain/settings/types';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import type { KeyValueStorage } from '../../i18n/persistence';
import { updateSetting } from '../../application/settings/usecases';
import { CloudImportBanner } from '../cloud/CloudImportBanner';
import { LastModified } from '../sync/LastModified';
import { useSaveStatus } from '../sync/useSaveStatus';
import { SaveStatusMessage } from '../sync/SaveStatusMessage';

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
  storage: KeyValueStorage;
  settings: Settings & Record<string, unknown>;
  onSettingsChange: (next: Settings & Record<string, unknown>) => void;
  /** Persisteert `settings` via de actieve repository (lokaal of cloud); zie App.tsx. */
  onSave: (
    settings: Settings & Record<string, unknown>,
    changedKeys?: readonly SettingsKey[],
  ) => Promise<boolean>;
  onReset: () => Promise<Settings & Record<string, unknown>>;
  onRefresh: () => Promise<Settings & Record<string, unknown>>;
  /**
   * Optionele cloud-import-handler. `App` laat deze undefined in lokale
   * modus zodat de banner dormant is (PR 5.3b-gedrag); in cloud-modus wordt
   * 'm gevuld (PR 5.3c-1).
   */
  onCloudMigrate?: () => Promise<{ ok: boolean; errors: string[] }>;
  /**
   * PR 5.4a: of deze gebruiker teamdata mag bewerken. `false` maakt alle
   * invoervelden readOnly/disabled, disablet de schrijfknoppen en toont een
   * korte "Alleen-lezen"-indicator. De refresh-knop blijft enabled
   * (read-only actie).
   */
  canWrite: boolean;
  updatedAt?: number;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

export function SettingsPanel({
  lang,
  storage,
  settings,
  onSettingsChange,
  onSave,
  onReset,
  onRefresh,
  onCloudMigrate,
  canWrite,
  updatedAt,
}: SettingsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    status: saveStatus,
    notifySuccess,
    notifyError,
    reset: resetSaveStatus,
  } = useSaveStatus();
  const changedKeysRef = useRef(new Set<SettingsKey>());

  function handleField<K extends keyof Settings>(field: K, value: Settings[K]) {
    changedKeysRef.current.add(field);
    const next = updateSetting(settings, field, value);
    onSettingsChange(next);
  }

  function handleLogoFile(file: File | undefined) {
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) {
      notifyError(t(lang, 'logoTooLargeError'));
      return;
    }
    resetSaveStatus();
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        handleField('logoUri', reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleReset() {
    const defaults = await onReset();
    onSettingsChange(defaults);
    resetSaveStatus();
    changedKeysRef.current.clear();
  }

  async function handleRefresh() {
    onSettingsChange(await onRefresh());
    resetSaveStatus();
    changedKeysRef.current.clear();
  }

  async function handleSave() {
    const changedKeys = [...changedKeysRef.current];
    const ok = await onSave(settings, changedKeys);
    if (ok) {
      changedKeysRef.current.clear();
      notifySuccess();
    } else {
      notifyError(t(lang, 'settingsSaveError'));
    }
  }

  const useClass = settings.useClassLimit === true;

  return (
    <section className="settings-panel" aria-label={t(lang, 'settingsTitle')}>
      <header className="settings-panel__header">
        <h2>{t(lang, 'settingsTitle')}</h2>
      </header>
      <LastModified lang={lang} updatedAt={updatedAt} testId="settings-last-modified" />

      <CloudImportBanner lang={lang} storage={storage} kind="settings" onMigrate={onCloudMigrate} />

      {canWrite ? null : (
        <p className="settings-read-only" data-testid="settings-read-only" role="status">
          {t(lang, 'settingsReadOnly')}
        </p>
      )}

      <fieldset className="settings-section">
        <legend>{t(lang, 'settingsSectionClub')}</legend>

        <label className="settings-field">
          <span className="settings-field__label">{t(lang, 'teamNameLabel')}</span>
          <input
            type="text"
            value={settings.teamName as string}
            readOnly={!canWrite}
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
              disabled={!canWrite}
              onClick={() => fileInputRef.current?.click()}
            >
              {t(lang, 'logoChooseBtn')}
            </button>
            {settings.logoUri ? (
              <button
                type="button"
                className="btn-outline"
                disabled={!canWrite}
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
            canWrite={canWrite}
          />
        </div>

        <div className="settings-field">
          <span className="settings-field__label">{t(lang, 'accentColorLabel')}</span>
          <ColorPickerRow
            value={settings.accentColor as string}
            onChange={(c) => handleField('accentColor', c)}
            testIdPrefix="accentColor"
            customLabel={t(lang, 'customColorBtn')}
            canWrite={canWrite}
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
            readOnly={!canWrite}
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
            readOnly={!canWrite}
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
            disabled={!canWrite}
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
                  readOnly={!canWrite}
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
                  readOnly={!canWrite}
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
                  readOnly={!canWrite}
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
                  readOnly={!canWrite}
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
                  readOnly={!canWrite}
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
                  readOnly={!canWrite}
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
                  readOnly={!canWrite}
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

      <SaveStatusMessage lang={lang} status={saveStatus} testIdPrefix="settings" />

      <div className="settings-actions">
        <button
          type="button"
          className="btn-primary"
          data-testid="settings-save"
          disabled={!canWrite}
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
          disabled={!canWrite}
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
  canWrite: boolean;
}

function ColorPickerRow({
  value,
  onChange,
  testIdPrefix,
  customLabel,
  canWrite,
}: ColorPickerRowProps) {
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
            disabled={!canWrite}
            data-testid={`${testIdPrefix}-${c.slice(1)}`}
            onClick={() => onChange(c)}
          />
        );
      })}
      <button
        type="button"
        className="btn-outline"
        disabled={!canWrite}
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
        disabled={!canWrite}
        data-testid={`${testIdPrefix}-native`}
        onChange={(e) => onChange((e.target as HTMLInputElement).value)}
      />
    </div>
  );
}
