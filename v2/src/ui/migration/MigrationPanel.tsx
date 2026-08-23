import { useEffect, useRef, useState } from 'preact/hooks';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import type { OrganizationRole } from '../../domain/organizations/types';
import type { KeyValueStorage } from '../../i18n/persistence';
import { canBulkMigrate } from '../../domain/migration/capability';
import { buildCloudMigrationPreview } from '../../domain/migration/preview';
import { buildMigrationRecoveryBackup } from '../../domain/migration/recoveryBackup';
import type {
  CloudMigrationItem,
  CloudMigrationPreview,
  LocalMigrationInventory,
  MigrationContextRef,
} from '../../domain/migration/types';
import type { MigrationRun, MigrationRunItemCheckpoint } from '../../domain/migration/run';
import type { CompletedGame } from '../../domain/game/types';
import { collectLocalMigrationInventory } from '../../infrastructure/migration/collectLocalMigrationInventory';
import { downloadBackupFile } from '../../infrastructure/backup/downloadBackupFile';
import { backupFilename } from '../../domain/backup/export';
import { downloadStuckMigrationItems } from '../../infrastructure/migration/exportStuckMigrationItems';
import type { CloudMigrationInventoryGateway } from '../../application/migration/CloudMigrationInventoryGateway';
import type {
  MigrationCoordinator,
  MigrationLocalSource,
} from '../../application/migration/MigrationCoordinator';

/**
 * PR 7.4c (docs/pr-7.4-plan.md §C 7.4c): de UI voor 7.4a/7.4b's engine —
 * bouwt zelf GEEN nieuwe domein-/orkestratielogica, roept uitsluitend
 * `buildCloudMigrationPreview()` + `MigrationCoordinator.prepareRun()`/
 * `.runMigration()` aan (exact zoals de plan-tekst voorschrijft: "geen
 * automatische migratie", elke stap is een expliciete gebruikersactie).
 * Stroom (werk 1): inventariseren → preview → herstelback-up → sterke
 * bevestiging → voortgang → resultaat → retry/export. Structuurpatroon
 * gespiegeld van `ui/backup/BackupPanel.tsx` (PR 6.6, hetzelfde
 * preview→bevestig→voortgang→resultaat-schermverloop, zie plan §A: "7.4
 * hergebruikt PR 6.6's ... preview, herstelback-up, contextbevestiging").
 *
 * **Dubbele-bevestiging-bescherming (werk 3):** de coordinator zelf heeft
 * GEEN interne mutex tegen twee overlappende `runMigration()`-aanroepen
 * vanuit hetzelfde tabblad — deze component is dus de PRIMAIRE bescherming
 * daartegen (`runningRef` + `disabled` op de bevestig-/retry-knop tijdens
 * `step === 'running'`). Wat de coordinator/Rules WEL garanderen: een
 * dubbele RETRY (bijv. na reload, of vanaf een tweede apparaat) levert
 * nooit een dubbel clulditem op — elke schrijfronde herleest eerst de
 * doelcontext (`resolveAction()`-recheck) en `completedGames`' Firestore-
 * create-only-regel weigert een tweede write op hetzelfde ID sowieso. Zie
 * `MigrationCoordinator.ts`'s docstring voor de volledige toelichting.
 */
export interface MigrationPanelProps {
  lang: Lang;
  organizationId: string;
  teamId: string;
  organizationName: string;
  teamName: string;
  /** Rol van de aanroeper IN DEZE doelcontext — de aanroeper (App) rendert
   * dit paneel alleen als `canBulkMigrate(callerRole)`, maar de check hieronder
   * wordt defensief herhaald (nooit alleen op de aanroeper vertrouwen). Heet
   * bewust GEEN `role` — eslint-plugin-jsx-a11y's `aria-role`-regel herkent
   * niet dat dit een gewone componentprop is, geen DOM-`role`-attribuut. */
  callerRole: OrganizationRole;
  storage: KeyValueStorage;
  inventoryGateway: CloudMigrationInventoryGateway;
  coordinator: MigrationCoordinator;
  writer: { authorUid: string; deviceId: string };
}

interface PreviewTarget {
  organizationId: string;
  teamId: string;
  callerRole: OrganizationRole;
}

type PanelState =
  | { step: 'idle' }
  | { step: 'loading' }
  | { step: 'error'; message: string }
  | { step: 'denied'; preview: CloudMigrationPreview }
  | {
      step: 'preview';
      preview: CloudMigrationPreview;
      inventory: LocalMigrationInventory;
      target: PreviewTarget;
    }
  | {
      step: 'backup';
      preview: CloudMigrationPreview;
      inventory: LocalMigrationInventory;
      target: PreviewTarget;
      downloaded: boolean;
    }
  | {
      step: 'confirm';
      preview: CloudMigrationPreview;
      inventory: LocalMigrationInventory;
      target: PreviewTarget;
    }
  | { step: 'blocked'; runId: string }
  | { step: 'running'; run: MigrationRun; inventory: LocalMigrationInventory }
  | { step: 'result'; run: MigrationRun; inventory: LocalMigrationInventory };

function toLocalSource(inventory: LocalMigrationInventory): MigrationLocalSource {
  const completedGames = new Map<string, CompletedGame>();
  if (inventory.completedGames.status === 'ok' && inventory.completedGames.value) {
    for (const game of inventory.completedGames.value) completedGames.set(game.id, game);
  }
  return {
    settings: inventory.settings.status === 'ok' ? inventory.settings.value : null,
    roster: inventory.roster.status === 'ok' ? inventory.roster.value : null,
    completedGames,
  };
}

const ITEM_STATUS_KEY: Record<MigrationRunItemCheckpoint['status'], StringKey> = {
  pending: 'migrationItemStatusPending',
  confirmed: 'migrationItemStatusConfirmed',
  conflict: 'migrationItemStatusConflict',
  failed: 'migrationItemStatusFailed',
  compensated: 'migrationItemStatusCompensated',
  compensationFailed: 'migrationItemStatusCompensationFailed',
};

const ACTION_KEY: Partial<Record<CloudMigrationItem['action'], StringKey>> = {
  create: 'migrationActionCreate',
  alreadyPresentIdentical: 'migrationActionAlreadyPresent',
  conflict: 'migrationActionConflict',
};

export function MigrationPanel({
  lang,
  organizationId,
  teamId,
  organizationName,
  teamName,
  callerRole,
  storage,
  inventoryGateway,
  coordinator,
  writer,
}: MigrationPanelProps) {
  const t = (key: StringKey): string => translate(lang, key);
  const [state, setState] = useState<PanelState>({ step: 'idle' });
  // Werk 3: primaire bescherming tegen twee overlappende bevestig-/retry-
  // klikken uit dit tabblad (zie bestandsdocstring hierboven).
  const runningRef = useRef(false);

  // Contextwissel-bescherming (werk 4-eis "contextwissel maakt preview
  // ongeldig") — zelfde patroon als BackupPanel: alleen vóór een write
  // (preview/backup/confirm) resetten, `running`/`result` blijven zichtbaar
  // (de run zelf is al aan zijn EIGEN doelcontext gebonden, zie
  // `MigrationRun.target`; `runMigration()` bewaakt een tussentijdse
  // contextwissel zelf via `isPreviewStillValid()`).
  useEffect(() => {
    if (state.step !== 'preview' && state.step !== 'backup' && state.step !== 'confirm') return;
    if (
      state.target.organizationId !== organizationId ||
      state.target.teamId !== teamId ||
      state.target.callerRole !== callerRole
    ) {
      setState({ step: 'idle' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, teamId, callerRole]);

  if (!canBulkMigrate(callerRole)) {
    // Defensieve tweede poort (werk-item "een scorer/viewer krijgt geen
    // bulkactie") — App.tsx rendert dit paneel al niet voor die rollen,
    // maar een prop-doorgeeffout mag nooit alsnog een startknop tonen.
    return null;
  }

  async function handleStart() {
    setState({ step: 'loading' });
    try {
      const inventory = collectLocalMigrationInventory(storage, organizationId, teamId);
      const completedGameIds =
        inventory.completedGames.status === 'ok' && inventory.completedGames.value
          ? inventory.completedGames.value.map((g) => g.id)
          : [];
      const activeGameId =
        inventory.activeGame.status === 'ok' && inventory.activeGame.value
          ? inventory.activeGame.value.id
          : null;
      const existingCloud = await inventoryGateway.readTargetSnapshot(
        organizationId,
        teamId,
        completedGameIds,
        activeGameId,
      );
      const ref: MigrationContextRef = { organizationId, teamId, organizationName, teamName };
      const preview = buildCloudMigrationPreview({
        now: new Date().toISOString(),
        source: ref,
        target: ref,
        callerRole,
        inventory,
        existingCloud,
      });
      if (!preview.allowed) {
        setState({ step: 'denied', preview });
        return;
      }
      setState({
        step: 'preview',
        preview,
        inventory,
        target: { organizationId, teamId, callerRole },
      });
    } catch {
      setState({ step: 'error', message: t('migrationErrorGeneric') });
    }
  }

  function handleToBackup() {
    if (state.step !== 'preview') return;
    setState({ ...state, step: 'backup', downloaded: false });
  }

  function handleDownloadBackup() {
    if (state.step !== 'backup') return;
    const envelope = buildMigrationRecoveryBackup(state.inventory);
    downloadBackupFile(envelope, backupFilename(`${teamName || teamId}-migratie-herstel`));
    setState({ ...state, downloaded: true });
  }

  function handleToConfirm() {
    if (state.step !== 'backup' || !state.downloaded) return;
    setState({
      step: 'confirm',
      preview: state.preview,
      inventory: state.inventory,
      target: state.target,
    });
  }

  async function handleConfirm() {
    if (state.step !== 'confirm') return;
    if (runningRef.current) return;
    runningRef.current = true;
    const { preview, inventory } = state;
    const local = toLocalSource(inventory);
    try {
      const prep = await coordinator.prepareRun(preview, writer.authorUid);
      if (prep.blockedByExistingRunId) {
        setState({ step: 'blocked', runId: prep.blockedByExistingRunId });
        return;
      }
      setState({ step: 'running', run: prep.run, inventory });
      const result = await coordinator.runMigration(prep.run, local, writer, {
        organizationId,
        teamId,
        role: callerRole,
      });
      setState({ step: 'result', run: result, inventory });
    } catch {
      setState({ step: 'error', message: t('migrationErrorGeneric') });
    } finally {
      runningRef.current = false;
    }
  }

  async function handleRetry() {
    if (state.step !== 'result') return;
    if (runningRef.current) return;
    runningRef.current = true;
    const { run, inventory } = state;
    const local = toLocalSource(inventory);
    try {
      setState({ step: 'running', run, inventory });
      const result = await coordinator.runMigration(run, local, writer, {
        organizationId,
        teamId,
        role: callerRole,
      });
      setState({ step: 'result', run: result, inventory });
    } catch {
      setState({ step: 'error', message: t('migrationErrorGeneric') });
    } finally {
      runningRef.current = false;
    }
  }

  function handleExport() {
    if (state.step !== 'result') return;
    downloadStuckMigrationItems(state.run);
  }

  function handleClose() {
    setState({ step: 'idle' });
  }

  return (
    <fieldset className="settings-section migration-panel" data-testid="migration-panel">
      <legend>{t('migrationTitle')}</legend>
      <p className="settings-explainer">{t('migrationDesc')}</p>

      {state.step === 'idle' ? (
        <div className="settings-actions">
          <button
            type="button"
            className="btn-outline"
            data-testid="migration-start-btn"
            onClick={() => void handleStart()}
          >
            {t('migrationStartBtn')}
          </button>
        </div>
      ) : null}

      {state.step === 'loading' ? (
        <p className="settings-explainer" role="status" data-testid="migration-loading">
          {t('migrationBuildingPreview')}
        </p>
      ) : null}

      {state.step === 'error' ? (
        <p className="settings-error" role="alert" data-testid="migration-error">
          {state.message}
        </p>
      ) : null}

      {state.step === 'denied' ? (
        <div className="settings-error" role="alert" data-testid="migration-denied">
          <p>{t('migrationDeniedCorruptTitle')}</p>
          <p className="settings-explainer">{t('migrationDeniedCorruptDesc')}</p>
          <ul className="backup-preview__list">
            {state.preview.warnings.map((w, i) => (
              <li key={i}>
                {w.code}
                {w.detail ? `: ${w.detail}` : ''}
              </li>
            ))}
          </ul>
          <button type="button" className="btn-outline" onClick={handleClose}>
            {t('migrationCloseBtn')}
          </button>
        </div>
      ) : null}

      {state.step === 'preview' ? (
        <MigrationPreviewCard
          lang={lang}
          preview={state.preview}
          organizationName={organizationName}
          teamName={teamName}
          onNext={handleToBackup}
          onCancel={handleClose}
        />
      ) : null}

      {state.step === 'backup' ? (
        <div className="card migration-backup" data-testid="migration-backup">
          <h3>{t('migrationBackupTitle')}</h3>
          <p className="settings-explainer">{t('migrationBackupDesc')}</p>
          <div className="settings-actions">
            <button
              type="button"
              className="btn-outline"
              data-testid="migration-backup-download-btn"
              onClick={handleDownloadBackup}
            >
              {t('migrationBackupDownloadBtn')}
            </button>
          </div>
          {state.downloaded ? (
            <p className="settings-explainer" role="status" data-testid="migration-backup-done">
              {t('migrationBackupConfirmLabel')}
            </p>
          ) : null}
          <div className="settings-actions">
            <button
              type="button"
              className="btn-primary"
              data-testid="migration-backup-next-btn"
              disabled={!state.downloaded}
              onClick={handleToConfirm}
            >
              {t('migrationBackupNextBtn')}
            </button>
            <button type="button" className="btn-outline" onClick={handleClose}>
              {t('migrationCancelBtn')}
            </button>
          </div>
        </div>
      ) : null}

      {state.step === 'confirm' ? (
        <div className="card migration-confirm" data-testid="migration-confirm">
          <h3>{t('migrationConfirmTitle')}</h3>
          <p className="settings-explainer" data-testid="migration-confirm-desc">
            {t('migrationConfirmDesc')
              .replace('{n}', String(state.preview.requiredWrites))
              .replace('{team}', teamName)}
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="btn-primary"
              data-testid="migration-confirm-btn"
              onClick={() => void handleConfirm()}
            >
              {t('migrationConfirmBtn')}
            </button>
            <button type="button" className="btn-outline" onClick={handleClose}>
              {t('migrationCancelBtn')}
            </button>
          </div>
        </div>
      ) : null}

      {state.step === 'blocked' ? (
        <p className="settings-error" role="alert" data-testid="migration-blocked">
          {t('migrationBlockedExistingRun')}
        </p>
      ) : null}

      {state.step === 'running' ? (
        <p
          className="settings-explainer"
          role="status"
          aria-live="polite"
          data-testid="migration-running"
        >
          {t('migrationRunningStatus')}
        </p>
      ) : null}

      {state.step === 'result' ? (
        <MigrationResultCard
          lang={lang}
          run={state.run}
          onRetry={() => void handleRetry()}
          onExport={handleExport}
          onClose={handleClose}
        />
      ) : null}
    </fieldset>
  );
}

function MigrationPreviewCard({
  lang,
  preview,
  organizationName,
  teamName,
  onNext,
  onCancel,
}: {
  lang: Lang;
  preview: CloudMigrationPreview;
  organizationName: string;
  teamName: string;
  onNext: () => void;
  onCancel: () => void;
}) {
  const t = (key: StringKey): string => translate(lang, key);
  const settingsItem = preview.items.find((i) => i.kind === 'settings');
  const rosterItem = preview.items.find((i) => i.kind === 'roster');
  const completedItems = preview.items.filter((i) => i.kind === 'completedGame');
  const activeItem = preview.items.find((i) => i.kind === 'activeGame');

  function sectionLine(item: CloudMigrationItem | undefined, sectionKey: StringKey) {
    if (!item) return null;
    const cloudPresent = item.action !== 'create';
    const actionKey = ACTION_KEY[item.action] ?? 'migrationActionCreate';
    return (
      <li data-testid={`migration-preview-${item.kind}`}>
        {t(sectionKey)}: {item.label} — {t('migrationLocalLabel')}
        {cloudPresent ? ` + ${t('migrationCloudLabel')}` : ''} — {t(actionKey)}
      </li>
    );
  }

  return (
    <div className="card migration-preview" data-testid="migration-preview">
      <h3>{t('migrationPreviewTitle')}</h3>
      <p className="settings-explainer" data-testid="migration-preview-target">
        {t('migrationPreviewTarget').replace('{org}', organizationName).replace('{team}', teamName)}
      </p>
      <ul className="backup-preview__list">
        {sectionLine(settingsItem, 'migrationSectionSettings')}
        {sectionLine(rosterItem, 'migrationSectionRoster')}
        <li data-testid="migration-preview-completedgames">
          {t('migrationSectionCompletedGames')}: {completedItems.length} — {preview.counts.create}{' '}
          {t('migrationActionCreate')}, {preview.counts.alreadyPresentIdentical}{' '}
          {t('migrationActionAlreadyPresent')}, {preview.counts.conflict}{' '}
          {t('migrationActionConflict')}
        </li>
      </ul>

      <h4>{t('migrationTrackingGameTitle')}</h4>
      {activeItem && activeItem.action === 'excludedTrackingGame' ? (
        <p className="settings-explainer" data-testid="migration-preview-tracking-excluded">
          {t('migrationTrackingGameExcludedTracking')}
        </p>
      ) : activeItem && activeItem.action === 'needsSeparateDecision' ? (
        <p className="settings-explainer" data-testid="migration-preview-tracking-decision">
          {t('migrationTrackingGameNeedsDecision')}
        </p>
      ) : (
        <p className="settings-explainer" data-testid="migration-preview-tracking-none">
          {t('migrationTrackingGameNone')}
        </p>
      )}

      <p className="settings-explainer" data-testid="migration-preview-required-writes">
        {t('migrationRequiredWritesLabel').replace('{n}', String(preview.requiredWrites))}
      </p>

      {preview.warnings.length > 0 ? (
        <>
          <h4>{t('migrationWarningsTitle')}</h4>
          <ul className="backup-preview__list" data-testid="migration-preview-warnings">
            {preview.warnings.map((w, i) => (
              <li key={i}>
                {w.code}
                {w.detail ? `: ${w.detail}` : ''}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="settings-actions">
        <button
          type="button"
          className="btn-primary"
          data-testid="migration-preview-next-btn"
          onClick={onNext}
        >
          {t('migrationNextToBackupBtn')}
        </button>
        <button type="button" className="btn-outline" onClick={onCancel}>
          {t('migrationCancelBtn')}
        </button>
      </div>
    </div>
  );
}

function resultTitleAndDescKeys(status: MigrationRun['status']): [StringKey, StringKey] {
  switch (status) {
    case 'completed':
      return ['migrationResultCompletedTitle', 'migrationResultCompletedDesc'];
    case 'actionNeeded':
      return ['migrationResultActionNeededTitle', 'migrationResultActionNeededDesc'];
    case 'compensationFailed':
      return ['migrationResultCompensationFailedTitle', 'migrationResultCompensationFailedDesc'];
    case 'paused':
      return ['migrationResultPausedTitle', 'migrationResultPausedDesc'];
  }
}

function MigrationResultCard({
  lang,
  run,
  onRetry,
  onExport,
  onClose,
}: {
  lang: Lang;
  run: MigrationRun;
  onRetry: () => void;
  onExport: () => void;
  onClose: () => void;
}) {
  const t = (key: StringKey): string => translate(lang, key);
  const [titleKey, descKey] = resultTitleAndDescKeys(run.status);
  const stuck = run.status === 'actionNeeded' || run.status === 'compensationFailed';

  return (
    <div
      className={
        run.status === 'completed' ? 'card migration-result' : 'settings-error migration-result'
      }
      role="status"
      aria-live="polite"
      data-testid="migration-result"
    >
      <h3>{t(titleKey)}</h3>
      <p className="settings-explainer">{t(descKey)}</p>
      <ul className="backup-preview__list" data-testid="migration-result-items">
        {run.items.map((item) => (
          <li
            key={`${item.kind}:${item.targetId}`}
            data-testid={`migration-item-${item.kind}-${item.targetId}`}
          >
            {item.kind} — {item.label} — {t(ITEM_STATUS_KEY[item.status])}
            {item.lastError ? `: ${item.lastError}` : ''}
          </li>
        ))}
      </ul>
      <div className="settings-actions">
        {stuck ? (
          <button
            type="button"
            className="btn-primary"
            data-testid="migration-retry-btn"
            onClick={onRetry}
          >
            {t('migrationRetryBtn')}
          </button>
        ) : null}
        {stuck ? (
          <button
            type="button"
            className="btn-outline"
            data-testid="migration-export-btn"
            onClick={onExport}
          >
            {t('migrationExportBtn')}
          </button>
        ) : null}
        <button
          type="button"
          className="btn-outline"
          data-testid="migration-close-btn"
          onClick={onClose}
        >
          {t('migrationCloseBtn')}
        </button>
      </div>
    </div>
  );
}
