import { useState } from 'preact/hooks';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import type { OrganizationRole } from '../../domain/organizations/types';
import { canRequestOrganizationDeletion } from '../../domain/deletion/capability';
import type { CleanupOverview, DeletionAssessment } from '../../domain/deletion/assessment';
import type { DeletionRequest } from '../../domain/deletion/types';
import type { OrganizationExportV1 } from '../../domain/export/types';
import { organizationExportFilename } from '../../domain/export/filename';
import { downloadOrganizationExportFile } from '../../infrastructure/export/downloadOrganizationExportFile';
import type {
  DeletionRequestCoordinator,
  DeletionRequestOutcome,
} from '../../application/deletion/DeletionRequestCoordinator';
import type { DeletionRequestWriteError } from '../../application/deletion/DeletionRequestGateway';
import { DeletionConfirmDialog } from './DeletionConfirmDialog';
import { formatDeletionDate } from './DeletionRequestBanner';

/**
 * PR 8.3c-1c (docs/pr-8.3c-besluitvoorstel.md §2.5): de owner-only UI voor het
 * verwijderverzoek. Bouwt zelf GEEN domeinlogica — alle beslissingen (blokkades,
 * bevestigingen, bewijs, overgangen) zitten in `DeletionRequestCoordinator`; dit
 * paneel toont het resultaat en vraagt de bevestigingen. Het paneel VERWIJDERT
 * NIETS: het maakt, annuleert en herstart uitsluitend een verzoek. De copy zegt
 * dat eerlijk (§2.3): nooit "organisatie verwijderd", nooit een suggestie van een
 * doorlooptijd die niet gegarandeerd is.
 *
 * Zoals `ExportPanel` is dit de enige plek die bepaalt of de actie überhaupt
 * gerenderd wordt; de coordinator herhaalt de rolcheck met de echte Auth-sessie.
 */
export interface DeletionPanelProps {
  lang: Lang;
  organizationId: string;
  organizationName: string;
  callerRole: OrganizationRole;
  coordinator: DeletionRequestCoordinator;
  /** Houdt de banner voor alle leden gelijk aan de laatst bekende serverstaat. */
  onRequestChange?: (request: DeletionRequest | null) => void;
}

type PanelState =
  | { step: 'idle' }
  | { step: 'loading' }
  | { step: 'error'; messageKey: StringKey }
  | {
      step: 'assessed';
      assessment: DeletionAssessment;
      cleanup: CleanupOverview;
      existing: DeletionRequest | null;
      notice: StringKey | null;
    }
  | {
      step: 'submitted';
      request: DeletionRequest;
      export: OrganizationExportV1;
      downloaded: boolean;
    };

type DialogState = { kind: 'request' | 'cancel'; inProgress: boolean; errorKey: StringKey | null };

function writeErrorKey(error: DeletionRequestWriteError): StringKey {
  switch (error.code) {
    case 'rejected':
      return 'deletionErrorRejected';
    case 'timeout':
      return 'deletionErrorTimeout';
    case 'readback-failed':
      return 'deletionErrorReadback';
    case 'not-signed-in':
      return 'deletionErrorNotSignedIn';
    case 'failed':
      return 'deletionErrorGeneric';
  }
}

export function DeletionPanel({
  lang,
  organizationId,
  organizationName,
  callerRole,
  coordinator,
  onRequestChange,
}: DeletionPanelProps) {
  const t = (key: StringKey): string => translate(lang, key);
  const [state, setState] = useState<PanelState>({ step: 'idle' });
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const displayName = organizationName || organizationId;

  if (!canRequestOrganizationDeletion(callerRole)) {
    // Defensieve tweede poort — App.tsx rendert dit paneel al niet voor andere
    // rollen, maar een prop-doorgeeffout mag nooit alsnog een knop tonen.
    return null;
  }

  /** Leest de actuele staat in; `notice` blijft zichtbaar na een mislukte poging. */
  async function load(notice: StringKey | null = null) {
    setState({ step: 'loading' });
    try {
      const outcome = await coordinator.assess(organizationId);
      if (outcome.status === 'denied') {
        setState({ step: 'error', messageKey: 'deletionErrorDenied' });
        return;
      }
      if (outcome.status === 'failed') {
        setState({
          step: 'error',
          messageKey:
            outcome.reason === 'organization-not-found'
              ? 'deletionErrorNotFound'
              : 'deletionErrorGeneric',
        });
        return;
      }
      onRequestChange?.(outcome.existingRequest);
      setAcknowledged(false);
      setState({
        step: 'assessed',
        assessment: outcome.assessment,
        cleanup: outcome.cleanup,
        existing: outcome.existingRequest,
        notice,
      });
    } catch {
      setState({ step: 'error', messageKey: 'deletionErrorGeneric' });
    }
  }

  async function handleSubmit() {
    setDialog({ kind: 'request', inProgress: true, errorKey: null });
    let outcome: DeletionRequestOutcome;
    try {
      outcome = await coordinator.request({ organizationId, acknowledgedStaleGames: acknowledged });
    } catch {
      setDialog({ kind: 'request', inProgress: false, errorKey: 'deletionErrorGeneric' });
      return;
    }
    switch (outcome.status) {
      case 'ok':
        setDialog(null);
        onRequestChange?.(outcome.request);
        setState({
          step: 'submitted',
          request: outcome.request,
          export: outcome.export,
          downloaded: false,
        });
        return;
      case 'blocked':
        // De situatie is sinds de beoordeling veranderd: opnieuw inlezen toont de blokkades.
        setDialog(null);
        await load();
        return;
      case 'needs-acknowledgement':
        setDialog(null);
        setState((prev) =>
          prev.step === 'assessed' ? { ...prev, notice: 'deletionNeedsAck' } : prev,
        );
        return;
      case 'already-open':
        setDialog(null);
        await load('deletionAlreadyOpen');
        return;
      case 'clock-behind':
        setDialog({ kind: 'request', inProgress: false, errorKey: 'deletionErrorClockBehind' });
        return;
      case 'write-failed':
        // Een timeout/weigering zegt niets over wat de server heeft: status opnieuw lezen.
        setDialog(null);
        await load(writeErrorKey(outcome.error));
        return;
      case 'denied':
        setDialog(null);
        setState({ step: 'error', messageKey: 'deletionErrorDenied' });
        return;
      case 'failed':
        setDialog({
          kind: 'request',
          inProgress: false,
          errorKey:
            outcome.reason === 'roundtripFailed'
              ? 'deletionErrorRoundtrip'
              : outcome.reason === 'organization-not-found'
                ? 'deletionErrorNotFound'
                : 'deletionErrorGeneric',
        });
        return;
    }
  }

  async function handleCancelRequest() {
    setDialog({ kind: 'cancel', inProgress: true, errorKey: null });
    try {
      const outcome = await coordinator.cancel(organizationId);
      setDialog(null);
      if (outcome.status === 'ok') {
        onRequestChange?.(outcome.request);
        await load('deletionStatusCancelled');
        return;
      }
      if (outcome.status === 'denied') {
        setState({ step: 'error', messageKey: 'deletionErrorDenied' });
        return;
      }
      if (outcome.status === 'write-failed') {
        await load(writeErrorKey(outcome.error));
        return;
      }
      await load();
    } catch {
      setDialog({ kind: 'cancel', inProgress: false, errorKey: 'deletionErrorGeneric' });
    }
  }

  function handleDownload() {
    if (state.step !== 'submitted') return;
    downloadOrganizationExportFile(state.export, organizationExportFilename(displayName));
    setState({ ...state, downloaded: true });
  }

  function handleClose() {
    setDialog(null);
    setState({ step: 'idle' });
  }

  return (
    <fieldset className="settings-section deletion-panel" data-testid="deletion-panel">
      <legend>{t('deletionTitle')}</legend>
      <p className="settings-explainer">{t('deletionDesc')}</p>

      {state.step === 'idle' ? (
        <div className="settings-actions">
          <button
            type="button"
            className="btn-outline"
            data-testid="deletion-start-btn"
            onClick={() => void load()}
          >
            {t('deletionStartBtn')}
          </button>
        </div>
      ) : null}

      {state.step === 'loading' ? (
        <p className="settings-explainer" role="status" data-testid="deletion-loading">
          {t('deletionLoading')}
        </p>
      ) : null}

      {state.step === 'error' ? (
        <div className="settings-error" role="alert" data-testid="deletion-error">
          <p>{t(state.messageKey)}</p>
          <div className="settings-actions">
            <button type="button" className="btn-outline" onClick={handleClose}>
              {t('deletionCloseBtn')}
            </button>
          </div>
        </div>
      ) : null}

      {state.step === 'assessed' ? (
        <AssessedView
          lang={lang}
          state={state}
          acknowledged={acknowledged}
          onAcknowledge={setAcknowledged}
          onRequest={() => setDialog({ kind: 'request', inProgress: false, errorKey: null })}
          onCancelRequest={() => setDialog({ kind: 'cancel', inProgress: false, errorKey: null })}
          onClose={handleClose}
        />
      ) : null}

      {state.step === 'submitted' ? (
        <div className="card deletion-submitted" data-testid="deletion-submitted">
          <h3>{t('deletionSubmittedTitle')}</h3>
          <p className="settings-explainer" role="status" data-testid="deletion-status">
            {t('deletionStatusRequested').replace(
              '{date}',
              formatDeletionDate(state.request.requestedAt, lang),
            )}
          </p>
          <div className="settings-error" role="alert" data-testid="deletion-sensitive-warning">
            <p>{t('deletionExportSensitive')}</p>
          </div>
          <div className="settings-actions">
            <button
              type="button"
              className="btn-primary"
              data-testid="deletion-download-btn"
              onClick={handleDownload}
            >
              {t('deletionExportDownloadBtn')}
            </button>
            <button type="button" className="btn-outline" onClick={() => void load()}>
              {t('deletionCloseBtn')}
            </button>
          </div>
          {state.downloaded ? (
            <p className="settings-explainer" role="status" data-testid="deletion-downloaded">
              {t('deletionExportDownloadedLabel')}
            </p>
          ) : null}
        </div>
      ) : null}

      {dialog?.kind === 'request' ? (
        <DeletionConfirmDialog
          testId="deletion-request-dialog"
          title={t('deletionConfirmTitle')}
          description={t('deletionConfirmDesc')}
          confirmLabel={t('deletionConfirmBtn')}
          inProgressLabel={t('deletionConfirmInProgress')}
          backLabel={t('deletionConfirmBackBtn')}
          requireText={displayName}
          requireTextLabel={t('deletionConfirmTypeLabel').replace('{org}', displayName)}
          inProgress={dialog.inProgress}
          errorMessage={dialog.errorKey ? t(dialog.errorKey) : null}
          onConfirm={() => void handleSubmit()}
          onCancel={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'cancel' ? (
        <DeletionConfirmDialog
          testId="deletion-cancel-dialog"
          title={t('deletionCancelTitle')}
          description={t('deletionCancelDesc')}
          confirmLabel={t('deletionCancelConfirmBtn')}
          inProgressLabel={t('deletionConfirmInProgress')}
          backLabel={t('deletionConfirmBackBtn')}
          inProgress={dialog.inProgress}
          errorMessage={dialog.errorKey ? t(dialog.errorKey) : null}
          onConfirm={() => void handleCancelRequest()}
          onCancel={() => setDialog(null)}
        />
      ) : null}
    </fieldset>
  );
}

const INVITATION_ROWS: {
  key: keyof CleanupOverview['removableInvitations'];
  labelKey: StringKey;
}[] = [
  { key: 'pending', labelKey: 'deletionCleanupInvitationsPending' },
  { key: 'accepted', labelKey: 'deletionCleanupInvitationsAccepted' },
  { key: 'claimed', labelKey: 'deletionCleanupInvitationsClaimed' },
  { key: 'revoked', labelKey: 'deletionCleanupInvitationsRevoked' },
];

function AssessedView({
  lang,
  state,
  acknowledged,
  onAcknowledge,
  onRequest,
  onCancelRequest,
  onClose,
}: {
  lang: Lang;
  state: Extract<PanelState, { step: 'assessed' }>;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  onRequest: () => void;
  onCancelRequest: () => void;
  onClose: () => void;
}) {
  const t = (key: StringKey): string => translate(lang, key);
  const { assessment, cleanup, existing, notice } = state;
  const open = existing !== null && existing.status !== 'cancelled';
  const blocked = assessment.blockers.length > 0;
  const staleCount = assessment.staleUnfinishedGames.length;
  const canSubmit = !open && !blocked && (staleCount === 0 || acknowledged);

  return (
    <div className="card deletion-assessed" data-testid="deletion-assessed">
      {notice ? (
        <p className="settings-error" role="alert" data-testid="deletion-notice">
          {t(notice)}
        </p>
      ) : null}

      {existing !== null ? (
        <p className="settings-explainer" role="status" data-testid="deletion-status">
          {existing.status === 'requested'
            ? t('deletionStatusRequested').replace(
                '{date}',
                formatDeletionDate(existing.requestedAt, lang),
              )
            : existing.status === 'executing'
              ? t('deletionStatusExecuting').replace(
                  '{date}',
                  formatDeletionDate(existing.requestedAt, lang),
                )
              : existing.status === 'failed'
                ? t('deletionStatusFailed').replace(
                    '{date}',
                    formatDeletionDate(existing.requestedAt, lang),
                  )
                : existing.status === 'completed'
                  ? t('deletionStatusCompleted')
                  : t('deletionStatusCancelled')}
        </p>
      ) : null}

      {!open && blocked ? (
        <div className="settings-error" role="alert" data-testid="deletion-blockers">
          <p>{t('deletionBlockersTitle')}</p>
          <ul>
            {assessment.blockers.map((blocker) => (
              <li
                key={`${blocker.code}-${blocker.teamId}-${blocker.code === 'recent-active-game' ? blocker.gameId : blocker.runId}`}
                data-testid={`deletion-blocker-${blocker.code}`}
              >
                {blocker.code === 'recent-active-game'
                  ? t('deletionBlockerRecentGame')
                      .replace('{team}', blocker.teamId)
                      .replace('{game}', blocker.gameId)
                  : t('deletionBlockerMigrationRun')
                      .replace('{team}', blocker.teamId)
                      .replace('{run}', blocker.runId)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!open && !blocked && staleCount > 0 ? (
        <div data-testid="deletion-stale">
          <h4>{t('deletionStaleTitle')}</h4>
          <p className="settings-explainer">
            {t('deletionStaleDesc').replace('{count}', String(staleCount))}
          </p>
          <label className="settings-field settings-field--row">
            <input
              type="checkbox"
              checked={acknowledged}
              data-testid="deletion-stale-ack"
              onChange={(e) => onAcknowledge((e.currentTarget as HTMLInputElement).checked)}
            />
            <span className="settings-field__label">{t('deletionStaleAck')}</span>
          </label>
        </div>
      ) : null}

      {!open && assessment.teamOnlyMemberCount > 0 ? (
        <p className="settings-explainer" data-testid="deletion-team-only">
          {t('deletionTeamOnlyNote').replace('{count}', String(assessment.teamOnlyMemberCount))}
        </p>
      ) : null}

      <h4>{t('deletionCleanupTitle')}</h4>
      <p className="settings-explainer">{t('deletionCleanupDesc')}</p>
      <ul className="backup-preview__list" data-testid="deletion-cleanup">
        <li data-testid="deletion-cleanup-tombstones">
          {t('deletionCleanupTombstones')}: {cleanup.redactableTombstones}
        </li>
        {INVITATION_ROWS.map((row) => (
          <li key={row.key} data-testid={`deletion-cleanup-invitations-${row.key}`}>
            {t(row.labelKey)}: {cleanup.removableInvitations[row.key]}
          </li>
        ))}
        <li data-testid="deletion-cleanup-abandoned-games">
          {t('deletionCleanupAbandonedGames')}: {cleanup.abandonedGames}
        </li>
        <li data-testid="deletion-cleanup-migration-runs">
          {t('deletionCleanupMigrationRuns')}: {cleanup.expiredMigrationRuns}
        </li>
      </ul>

      <div className="settings-actions">
        {existing?.status === 'requested' ? (
          <button
            type="button"
            className="btn-outline"
            data-testid="deletion-cancel-request-btn"
            onClick={onCancelRequest}
          >
            {t('deletionCancelRequestBtn')}
          </button>
        ) : null}
        {!open ? (
          <button
            type="button"
            className="btn-primary"
            data-testid="deletion-request-btn"
            disabled={!canSubmit}
            onClick={onRequest}
          >
            {t('deletionRequestBtn')}
          </button>
        ) : null}
        <button type="button" className="btn-outline" onClick={onClose}>
          {t('deletionCloseBtn')}
        </button>
      </div>
    </div>
  );
}
