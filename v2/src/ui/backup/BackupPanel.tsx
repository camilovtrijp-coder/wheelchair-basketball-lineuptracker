import { useRef, useState } from 'preact/hooks';
import type { AsyncSettingsRepository } from '../../application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../application/roster/AsyncRosterRepository';
import type { GameRepository } from '../../application/game/GameRepository';
import type { CompletedGameRepository } from '../../application/game/CompletedGameRepository';
import {
  captureSnapshot,
  runImport,
  type BackupCoordinatorDeps,
} from '../../application/backup/BackupCoordinator';
import { buildBackupPayload, backupFilename } from '../../domain/backup/export';
import { parseBackupPayload } from '../../domain/backup/parse';
import { buildImportPreview } from '../../domain/backup/preview';
import type {
  BackupV2Data,
  BackupValidationError,
  ImportJournalEntry,
  ImportPreview,
} from '../../domain/backup/types';
import { readBackupFile } from '../../infrastructure/backup/readBackupFile';
import { downloadBackupFile } from '../../infrastructure/backup/downloadBackupFile';
import type { Settings, SettingsKey } from '../../domain/settings/types';
import type { Roster } from '../../domain/roster/types';
import type { ActiveGame } from '../../domain/game/types';
import { translate, type Lang, type StringKey } from '../../i18n/strings';

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

export interface BackupPanelProps {
  lang: Lang;
  canWrite: boolean;
  organizationId: string;
  teamId: string;
  organizationName: string;
  teamName: string;
  settings: Settings & Record<string, unknown>;
  roster: Roster;
  activeGame: ActiveGame | null;
  settingsRepo: AsyncSettingsRepository;
  rosterRepo: AsyncRosterRepository;
  gameRepo: GameRepository;
  completedGameRepo: CompletedGameRepository;
  saveSettings: (
    payload: Settings & Record<string, unknown>,
    changedKeys?: readonly SettingsKey[],
  ) => Promise<boolean>;
  saveRoster: (payload: Roster) => Promise<boolean>;
  setLang: (lang: Lang) => void;
  /** App ververst zijn live state (settings/roster/game/historie) na een geslaagde import. */
  onImported: () => void;
}

type PanelState =
  | { step: 'idle' }
  | { step: 'error'; message: string }
  | { step: 'preview'; data: BackupV2Data; preview: ImportPreview }
  | { step: 'running' }
  | { step: 'done'; ok: true }
  | { step: 'done'; ok: false; journal: ImportJournalEntry[] };

const SECTION_LABEL_KEY: Record<ImportJournalEntry['section'], StringKey> = {
  settings: 'backupSectionSettings',
  roster: 'backupSectionRoster',
  activeGame: 'backupSectionActiveGame',
  completedGames: 'backupSectionCompletedGames',
  lang: 'backupSectionLang',
};

function firstErrorMessage(lang: Lang, errors: BackupValidationError[]): string {
  const first = errors[0]!;
  if (first.code === 'emptyData') return t(lang, 'validationNoRecognizableData');
  if (
    first.code === 'notPlainObject' ||
    first.code === 'wrongType' ||
    first.code === 'dataNotObject' ||
    first.code === 'invalidVersion' ||
    first.code === 'fileTooLarge' ||
    first.code === 'fileUnreadable' ||
    first.code === 'fileNotJson'
  ) {
    return t(lang, 'importBackupInvalid');
  }
  const detail = `${first.code}${first.detail ? `: ${first.detail}` : ''}`;
  const more =
    errors.length > 1
      ? t(lang, 'importBackupInvalidDataAndMore').replace('{n}', String(errors.length - 1))
      : '';
  return t(lang, 'importBackupInvalidData').replace('{details}', detail) + more;
}

export function BackupPanel({
  lang,
  canWrite,
  organizationId,
  teamId,
  organizationName,
  teamName,
  settings,
  roster,
  activeGame,
  settingsRepo,
  rosterRepo,
  gameRepo,
  completedGameRepo,
  saveSettings,
  saveRoster,
  setLang,
  onImported,
}: BackupPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<PanelState>({ step: 'idle' });

  function handleExport() {
    const payload = buildBackupPayload(
      {
        settings,
        roster,
        activeGame,
        completedGames: completedGameRepo.list(),
        lang,
      },
      new Date(),
      { organizationId, teamId },
    );
    downloadBackupFile(payload, backupFilename(settings.teamName as string));
  }

  async function handleFileChosen(file: File | undefined) {
    if (!file) return;
    const read = await readBackupFile(file);
    if (!read.ok) {
      setState({ step: 'error', message: t(lang, 'importBackupInvalid') });
      return;
    }
    const parsed = parseBackupPayload(read.raw);
    if (parsed.errors.length > 0) {
      setState({ step: 'error', message: firstErrorMessage(lang, parsed.errors) });
      return;
    }
    const preview = buildImportPreview(parsed.data, parsed.version, parsed.exportedAt);
    setState({ step: 'preview', data: parsed.data, preview });
  }

  function deps(): BackupCoordinatorDeps {
    return {
      settingsRepo,
      rosterRepo,
      gameRepo,
      completedGameRepo,
      saveSettings,
      saveRoster,
      setLang,
    };
  }

  async function handleConfirmImport() {
    if (state.step !== 'preview') return;
    setState({ step: 'running' });
    const d = deps();
    const snapshot = await captureSnapshot(d);

    // Plan §C.8: eerst automatisch een herstelback-up van de HUIDIGE
    // doelcontext downloaden, vóór er iets geschreven wordt.
    const restorePayload = buildBackupPayload(
      {
        settings: snapshot.settings,
        roster: snapshot.roster,
        activeGame: snapshot.activeGame,
        completedGames: snapshot.completedGames,
        lang,
      },
      new Date(),
      { organizationId, teamId },
    );
    downloadBackupFile(restorePayload, backupFilename(`${settings.teamName || teamId}-herstel`));

    const result = await runImport(d, state.data, { organizationId, teamId }, snapshot);
    if (result.ok) {
      setState({ step: 'done', ok: true });
      onImported();
    } else {
      setState({ step: 'done', ok: false, journal: result.journal });
    }
  }

  function handleCancelPreview() {
    setState({ step: 'idle' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleDismissResult() {
    setState({ step: 'idle' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <fieldset className="settings-section backup-panel" data-testid="backup-panel">
      <legend>{t(lang, 'backupTitle')}</legend>
      <p className="settings-explainer">{t(lang, 'backupDesc')}</p>

      <div className="settings-actions">
        <button
          type="button"
          className="btn-outline"
          data-testid="backup-export-btn"
          onClick={handleExport}
        >
          {t(lang, 'backupExportBtn')}
        </button>
        <button
          type="button"
          className="btn-outline"
          data-testid="backup-import-btn"
          disabled={!canWrite || state.step === 'running'}
          onClick={() => fileInputRef.current?.click()}
        >
          {t(lang, 'backupImportBtn')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style="display:none"
          data-testid="backup-file-input"
          onChange={(e) =>
            void handleFileChosen((e.target as HTMLInputElement).files?.[0] ?? undefined)
          }
        />
      </div>

      {state.step === 'error' ? (
        <p className="settings-error" role="alert" data-testid="backup-error">
          {state.message}
        </p>
      ) : null}

      {state.step === 'preview' ? (
        <BackupPreviewCard
          lang={lang}
          preview={state.preview}
          organizationName={organizationName}
          teamName={teamName}
          onConfirm={() => void handleConfirmImport()}
          onCancel={handleCancelPreview}
        />
      ) : null}

      {state.step === 'running' ? (
        <p className="settings-explainer" role="status" data-testid="backup-running">
          {t(lang, 'backupRestoreDownloading')}
        </p>
      ) : null}

      {state.step === 'done' && state.ok ? (
        <p className="settings-explainer" role="status" data-testid="backup-success">
          {t(lang, 'backupImportSuccess')}{' '}
          <button type="button" className="btn-outline" onClick={handleDismissResult}>
            OK
          </button>
        </p>
      ) : null}

      {state.step === 'done' && !state.ok ? (
        <div className="settings-error" role="alert" data-testid="backup-failed">
          <p>
            {t(lang, 'backupImportFailed').replace(
              '{section}',
              t(lang, SECTION_LABEL_KEY[failedSection(state.journal)]),
            )}
          </p>
          <button type="button" className="btn-outline" onClick={handleDismissResult}>
            OK
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}

function failedSection(journal: ImportJournalEntry[]): ImportJournalEntry['section'] {
  return journal.find((e) => e.outcome === 'failed')?.section ?? journal[0]!.section;
}

function BackupPreviewCard({
  lang,
  preview,
  organizationName,
  teamName,
  onConfirm,
  onCancel,
}: {
  lang: Lang;
  preview: ImportPreview;
  organizationName: string;
  teamName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  function effectLabel(effect: 'replace' | 'clear' | 'unchanged'): string {
    if (effect === 'replace') return t(lang, 'backupEffectReplace');
    if (effect === 'clear') return t(lang, 'backupEffectClear');
    return t(lang, 'backupEffectUnchanged');
  }

  return (
    <div className="card backup-preview" data-testid="backup-preview">
      <h3>{t(lang, 'backupPreviewTitle')}</h3>
      <p className="settings-explainer" data-testid="backup-preview-target">
        {t(lang, 'backupPreviewTarget')
          .replace('{org}', `${organizationName} (${teamName})`)
          .replace('{team}', teamName)}
      </p>
      <ul className="backup-preview__list">
        <li data-testid="backup-preview-settings">
          {t(lang, 'backupSectionSettings')}: {preview.settings.teamName ?? '—'} (
          {effectLabel(preview.settings.effect)})
        </li>
        <li data-testid="backup-preview-roster">
          {t(lang, 'backupSectionRoster')}: {preview.roster.playerCount} (
          {effectLabel(preview.roster.effect)})
        </li>
        <li data-testid="backup-preview-activegame">
          {t(lang, 'backupSectionActiveGame')}:{' '}
          {preview.activeGame.opponent ?? t(lang, 'backupPreviewNotPresent')} (
          {effectLabel(preview.activeGame.effect)})
        </li>
        <li data-testid="backup-preview-completedgames">
          {t(lang, 'backupSectionCompletedGames')}: {preview.completedGames.count} (
          {effectLabel(preview.completedGames.effect)})
        </li>
        <li data-testid="backup-preview-lang">
          {t(lang, 'backupSectionLang')}: {preview.lang.value ?? t(lang, 'backupPreviewNotPresent')}{' '}
          ({effectLabel(preview.lang.effect)})
        </li>
      </ul>
      <div className="settings-actions">
        <button
          type="button"
          className="btn-primary"
          data-testid="backup-confirm-btn"
          onClick={onConfirm}
        >
          {t(lang, 'backupConfirmBtn')}
        </button>
        <button
          type="button"
          className="btn-outline"
          data-testid="backup-cancel-btn"
          onClick={onCancel}
        >
          {t(lang, 'backupCancelBtn')}
        </button>
      </div>
    </div>
  );
}
