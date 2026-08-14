import { useEffect, useRef, useState } from 'preact/hooks';
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
import type { Settings } from '../../domain/settings/types';
import type { Roster } from '../../domain/roster/types';
import { translate, type Lang, type StringKey } from '../../i18n/strings';

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

/**
 * Doelcontext + bevoegdheid zoals bevestigd bij het bouwen van de preview
 * (externe PR-6.6-review, aug. 2026). `BackupPanel` blijft bestaan wanneer
 * `AuthGate`/`App` dezelfde instance nieuwe context-/`canWrite`-props geeft
 * bij een organisatie-/teamwissel — zonder deze binding zou een reeds
 * ingelezen back-up tegen de NIEUWE repositories/doel-ID's bevestigd kunnen
 * worden i.p.v. dat de preview ongeldig wordt (plan §C.7).
 */
interface PreviewTarget {
  organizationId: string;
  teamId: string;
  canWrite: boolean;
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
  /** Eigenaarsbesluit §E.3: settings/roster volgen de actieve repositorymodus
   * (`AppRepositories.mode`) — wedstrijdhistorie/actieve wedstrijd zijn tot
   * en met fase 6 altijd lokaal (zie `BackupPreviewCard`). */
  settingsRosterMode: 'local' | 'cloud';
  settingsRepo: AsyncSettingsRepository;
  rosterRepo: AsyncRosterRepository;
  gameRepo: GameRepository;
  completedGameRepo: CompletedGameRepository;
  setLang: (lang: Lang) => void;
  /** App ververst zijn live state (settings/roster/game/historie) na een geslaagde import. */
  onImported: () => void;
}

type PanelState =
  | { step: 'idle' }
  | { step: 'error'; message: string }
  | { step: 'preview'; data: BackupV2Data; preview: ImportPreview; target: PreviewTarget }
  | { step: 'running' }
  | { step: 'done'; ok: true; journal: ImportJournalEntry[] }
  | { step: 'done'; ok: false; journal: ImportJournalEntry[] };

const SECTION_LABEL_KEY: Record<ImportJournalEntry['section'], StringKey> = {
  settings: 'backupSectionSettings',
  roster: 'backupSectionRoster',
  activeGame: 'backupSectionActiveGame',
  completedGames: 'backupSectionCompletedGames',
  lang: 'backupSectionLang',
};

const OUTCOME_LABEL: Record<ImportJournalEntry['outcome'], string> = {
  written: '✓',
  skipped: '—',
  failed: '✗',
  rolledBack: '↩',
  rollbackFailed: '⚠',
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
    first.code === 'fileNotJson' ||
    first.code === 'migrationFailed'
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
  settingsRosterMode,
  settingsRepo,
  rosterRepo,
  gameRepo,
  completedGameRepo,
  setLang,
  onImported,
}: BackupPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<PanelState>({ step: 'idle' });

  // Externe PR-6.6-review (aug. 2026): een organisatie-/teamwissel (of een
  // capabiliteitswijziging, bv. een rolwijziging die tussentijds binnenkomt)
  // ná het bouwen van de preview maakt hem ongeldig. `App` hergebruikt
  // dezelfde `BackupPanel`-instance met nieuwe props (geen remount), dus
  // zonder deze guard zou een reeds ingelezen back-up alsnog tegen de
  // NIEUWE context bevestigd kunnen worden.
  useEffect(() => {
    if (state.step !== 'preview') return;
    if (
      state.target.organizationId !== organizationId ||
      state.target.teamId !== teamId ||
      state.target.canWrite !== canWrite
    ) {
      setState({ step: 'idle' });
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, teamId, canWrite]);

  function handleExport() {
    if (!canWrite) return;
    // Externe PR-6.6-review: zelfde reden als captureSnapshot() — een
    // storage-/parsefout OF een individueel corrupt/mistagged item mag
    // nooit als "leeg"/"volledig" geëxporteerd worden. `safeListStrict()`
    // (i.p.v. het permissievere `safeList()`) meldt daarom al bij één
    // afgekeurd item `status:'error'`.
    const completedResult = completedGameRepo.safeListStrict
      ? completedGameRepo.safeListStrict()
      : completedGameRepo.safeList
        ? completedGameRepo.safeList()
        : { status: 'ok' as const, games: completedGameRepo.list() };
    const activeResult = gameRepo.safeRead();
    if (completedResult.status === 'error' || activeResult.status === 'error') {
      setState({ step: 'error', message: t(lang, 'statsReadError') });
      return;
    }
    const payload = buildBackupPayload(
      {
        settings,
        roster,
        activeGame: activeResult.game,
        completedGames: completedResult.games,
        lang,
      },
      new Date(),
      { organizationId, teamId },
    );
    downloadBackupFile(payload, backupFilename(settings.teamName as string));
  }

  async function handleFileChosen(file: File | undefined) {
    if (!canWrite || !file) return;
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
    setState({
      step: 'preview',
      data: parsed.data,
      preview,
      target: { organizationId, teamId, canWrite },
    });
  }

  function deps(): BackupCoordinatorDeps {
    return {
      settingsRepo,
      rosterRepo,
      gameRepo,
      completedGameRepo,
      setLang,
    };
  }

  async function handleConfirmImport() {
    if (state.step !== 'preview') return;
    // Herbevestiging vlak vóór schrijven (externe PR-6.6-review): de
    // preview-binding hierboven vangt de meeste gevallen af via de
    // useEffect, maar deze check is de laatste, synchrone poort vlak vóór
    // een echte write — nooit vertrouwen op alleen de knop-`disabled`-state.
    if (
      !canWrite ||
      state.target.organizationId !== organizationId ||
      state.target.teamId !== teamId
    ) {
      setState({ step: 'idle' });
      return;
    }
    const target = { organizationId, teamId };
    const importData = state.data;
    setState({ step: 'running' });
    const d = deps();
    const snapshotResult = await captureSnapshot(d);
    if (!snapshotResult.ok) {
      setState({ step: 'error', message: t(lang, 'statsReadError') });
      return;
    }
    const snapshot = snapshotResult.snapshot;

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
      target,
    );
    downloadBackupFile(restorePayload, backupFilename(`${settings.teamName || teamId}-herstel`));

    const result = await runImport(d, importData, target, snapshot);
    if (result.ok) {
      setState({ step: 'done', ok: true, journal: result.journal });
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
          disabled={!canWrite}
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
          disabled={!canWrite}
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
          settingsRosterMode={settingsRosterMode}
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
        <div className="settings-explainer" role="status" data-testid="backup-success">
          <p>{t(lang, 'backupImportSuccess')}</p>
          <JournalList journal={state.journal} lang={lang} />
          <button type="button" className="btn-outline" onClick={handleDismissResult}>
            OK
          </button>
        </div>
      ) : null}

      {state.step === 'done' && !state.ok ? (
        <div className="settings-error" role="alert" data-testid="backup-failed">
          <p>
            {t(lang, 'backupImportFailed').replace(
              '{section}',
              t(lang, SECTION_LABEL_KEY[failedSection(state.journal)]),
            )}
          </p>
          <JournalList journal={state.journal} lang={lang} />
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

/** Toont het hersteljournaal zowel bij succes als bij falen (externe
 * PR-6.6-review, aug. 2026: het journal was alleen bij falen zichtbaar,
 * terwijl §G ook bij een geslaagde import inzicht in de per-sectie-uitkomst
 * vereist). */
function JournalList({ journal, lang }: { journal: ImportJournalEntry[]; lang: Lang }) {
  return (
    <ul className="backup-preview__list" data-testid="backup-journal">
      {journal.map((entry, i) => (
        <li key={i} data-testid={`backup-journal-${entry.section}-${entry.outcome}`}>
          {OUTCOME_LABEL[entry.outcome]} {t(lang, SECTION_LABEL_KEY[entry.section])}:{' '}
          {entry.outcome}
        </li>
      ))}
    </ul>
  );
}

function BackupPreviewCard({
  lang,
  preview,
  organizationName,
  teamName,
  settingsRosterMode,
  onConfirm,
  onCancel,
}: {
  lang: Lang;
  preview: ImportPreview;
  organizationName: string;
  teamName: string;
  settingsRosterMode: 'local' | 'cloud';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  function effectLabel(effect: 'replace' | 'clear' | 'unchanged'): string {
    if (effect === 'replace') return t(lang, 'backupEffectReplace');
    if (effect === 'clear') return t(lang, 'backupEffectClear');
    return t(lang, 'backupEffectUnchanged');
  }

  // Eigenaarsbesluit §E.3: settings/roster volgen de huidige lokale/cloud-
  // repositorymodus; wedstrijdhistorie/actieve wedstrijd zijn tot en met
  // fase 6 altijd lokaal per team (volledige cloudmigratie is fase 7-scope).
  // Nog niet in de UI zichtbaar vóór deze review (externe PR-6.6-review,
  // aug. 2026, punt 5) — een gebruiker in cloudmodus kon niet aan de
  // preview zien dat settings/roster naar de cloud gaan terwijl historie
  // altijd lokaal blijft.
  const settingsRosterDestination =
    settingsRosterMode === 'cloud'
      ? t(lang, 'backupDestinationCloud')
      : t(lang, 'backupDestinationLocal');
  const gameDestination = t(lang, 'backupDestinationLocal');

  return (
    <div className="card backup-preview" data-testid="backup-preview">
      <h3>{t(lang, 'backupPreviewTitle')}</h3>
      <p className="settings-explainer" data-testid="backup-preview-target">
        {t(lang, 'backupPreviewTarget')
          .replace('{org}', `${organizationName} (${teamName})`)
          .replace('{team}', teamName)}
      </p>
      <p className="xs mut2" data-testid="backup-preview-meta">
        v{preview.sourceVersion} · {preview.exportedAt ?? '—'}
      </p>
      <ul className="backup-preview__list">
        <li data-testid="backup-preview-settings">
          {t(lang, 'backupSectionSettings')}: {preview.settings.teamName ?? '—'} (
          {effectLabel(preview.settings.effect)}, {settingsRosterDestination})
        </li>
        <li data-testid="backup-preview-roster">
          {t(lang, 'backupSectionRoster')}: {preview.roster.playerCount} (
          {effectLabel(preview.roster.effect)}, {settingsRosterDestination})
        </li>
        <li data-testid="backup-preview-activegame">
          {t(lang, 'backupSectionActiveGame')}:{' '}
          {preview.activeGame.opponent ?? t(lang, 'backupPreviewNotPresent')} (
          {effectLabel(preview.activeGame.effect)}, {gameDestination})
        </li>
        <li data-testid="backup-preview-completedgames">
          {t(lang, 'backupSectionCompletedGames')}: {preview.completedGames.count} (
          {effectLabel(preview.completedGames.effect)}, {gameDestination})
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
