import { useState } from 'preact/hooks';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import type { OrganizationRole } from '../../domain/organizations/types';
import { canExportOrganization } from '../../domain/export/types';
import type { OrganizationExportV1 } from '../../domain/export/types';
import { organizationExportFilename } from '../../domain/export/filename';
import { downloadOrganizationExportFile } from '../../infrastructure/export/downloadOrganizationExportFile';
import type { OrganizationExportCoordinator } from '../../application/export/OrganizationExportCoordinator';

/**
 * PR 8.3b deel 2/2 (docs/pr-8.3-plan.md §C 8.3b werk 4): de owner-only UI
 * voor deel 1/2's export-engine — bouwt zelf GEEN nieuwe domein-/
 * orkestratielogica, roept uitsluitend `OrganizationExportCoordinator.run()`
 * aan en toont het resultaat. Stroom: inlezen → preview (doelorganisatie,
 * teams, aantallen, gevoelige-inhoudwaarschuwing) → expliciete downloadactie.
 * Structuurpatroon gespiegeld van `ui/migration/MigrationPanel.tsx`: elke
 * stap is een expliciete gebruikersactie, geen automatische download.
 *
 * De coordinator zelf herhaalt de rolcheck als defense-in-depth (zie
 * `OrganizationExportCoordinator.run()`'s docstring) — dit paneel is dus
 * niet het enige controlepunt, maar WEL het enige dat bepaalt of de
 * exportactie überhaupt gerenderd wordt (plan §C 8.3b werk 4: "voor andere
 * rollen wordt de actie niet gerenderd").
 */
export interface ExportPanelProps {
  lang: Lang;
  organizationId: string;
  organizationName: string;
  callerRole: OrganizationRole;
  callerUid: string;
  coordinator: OrganizationExportCoordinator;
}

type PanelState =
  | { step: 'idle' }
  | { step: 'loading' }
  | { step: 'error'; messageKey: StringKey }
  | { step: 'preview'; data: OrganizationExportV1 }
  | { step: 'downloaded'; data: OrganizationExportV1 };

export function ExportPanel({
  lang,
  organizationId,
  organizationName,
  callerRole,
  callerUid,
  coordinator,
}: ExportPanelProps) {
  const t = (key: StringKey): string => translate(lang, key);
  const [state, setState] = useState<PanelState>({ step: 'idle' });

  if (!canExportOrganization(callerRole)) {
    // Defensieve tweede poort — App.tsx rendert dit paneel al niet voor
    // andere rollen, maar een prop-doorgeeffout mag nooit alsnog een
    // startknop tonen (zelfde bescherming als MigrationPanel).
    return null;
  }

  async function handleStart() {
    setState({ step: 'loading' });
    try {
      // Herreview PR #89 (P1): `callerRole` gaat NIET mee — de coordinator
      // bepaalt de rol nu zelf, autoritatief, via `gateway.readCallerRole()`
      // (zie `OrganizationExportCoordinator.run()`'s docstring). `callerRole`
      // hierboven blijft uitsluitend de defensieve render-poort van dit
      // paneel.
      const outcome = await coordinator.run({ organizationId, callerUid });
      if (outcome.status === 'denied') {
        setState({ step: 'error', messageKey: 'exportErrorGeneric' });
        return;
      }
      if (outcome.status === 'failed') {
        setState({
          step: 'error',
          messageKey:
            outcome.reason === 'organization-not-found'
              ? 'exportErrorNotFound'
              : outcome.reason === 'roundtripFailed'
                ? 'exportErrorRoundtrip'
                : 'exportErrorGeneric',
        });
        return;
      }
      setState({ step: 'preview', data: outcome.export });
    } catch {
      setState({ step: 'error', messageKey: 'exportErrorGeneric' });
    }
  }

  function handleDownload() {
    if (state.step !== 'preview') return;
    downloadOrganizationExportFile(
      state.data,
      organizationExportFilename(organizationName || organizationId),
    );
    setState({ step: 'downloaded', data: state.data });
  }

  function handleClose() {
    setState({ step: 'idle' });
  }

  return (
    <fieldset className="settings-section export-panel" data-testid="export-panel">
      <legend>{t('exportTitle')}</legend>
      <p className="settings-explainer">{t('exportDesc')}</p>

      {state.step === 'idle' ? (
        <div className="settings-actions">
          <button
            type="button"
            className="btn-outline"
            data-testid="export-start-btn"
            onClick={() => void handleStart()}
          >
            {t('exportStartBtn')}
          </button>
        </div>
      ) : null}

      {state.step === 'loading' ? (
        <p className="settings-explainer" role="status" data-testid="export-loading">
          {t('exportBuilding')}
        </p>
      ) : null}

      {state.step === 'error' ? (
        <div className="settings-error" role="alert" data-testid="export-error">
          <p>{t(state.messageKey)}</p>
          <div className="settings-actions">
            <button type="button" className="btn-outline" onClick={handleClose}>
              {t('exportCloseBtn')}
            </button>
          </div>
        </div>
      ) : null}

      {state.step === 'preview' || state.step === 'downloaded' ? (
        <ExportPreviewCard
          lang={lang}
          organizationId={organizationId}
          data={state.data}
          downloaded={state.step === 'downloaded'}
          onDownload={handleDownload}
          onClose={handleClose}
        />
      ) : null}
    </fieldset>
  );
}

const COUNT_ROWS: { key: keyof OrganizationExportV1['counts']; labelKey: StringKey }[] = [
  { key: 'organizationMembers', labelKey: 'exportCountOrganizationMembers' },
  { key: 'invitations', labelKey: 'exportCountInvitations' },
  { key: 'teams', labelKey: 'exportCountTeams' },
  { key: 'teamMembers', labelKey: 'exportCountTeamMembers' },
  { key: 'settingsDocuments', labelKey: 'exportCountSettingsDocuments' },
  { key: 'rosterPlayers', labelKey: 'exportCountRosterPlayers' },
  { key: 'games', labelKey: 'exportCountGames' },
  { key: 'gameActions', labelKey: 'exportCountGameActions' },
  { key: 'completedGames', labelKey: 'exportCountCompletedGames' },
  { key: 'migrationRuns', labelKey: 'exportCountMigrationRuns' },
];

function ExportPreviewCard({
  lang,
  organizationId,
  data,
  downloaded,
  onDownload,
  onClose,
}: {
  lang: Lang;
  organizationId: string;
  data: OrganizationExportV1;
  downloaded: boolean;
  onDownload: () => void;
  onClose: () => void;
}) {
  const t = (key: StringKey): string => translate(lang, key);
  return (
    <div className="card export-preview" data-testid="export-preview">
      <h3>{t('exportPreviewTitle')}</h3>
      <p className="settings-explainer" data-testid="export-preview-target">
        {t('exportPreviewTarget')
          .replace('{org}', data.sourceContext.organizationName)
          .replace('{id}', organizationId)}
      </p>

      <h4>{t('exportPreviewTeamsTitle')}</h4>
      <ul className="backup-preview__list" data-testid="export-preview-teams">
        {data.teams.map((team) => (
          <li key={team.teamId} data-testid={`export-preview-team-${team.teamId}`}>
            {team.name}
          </li>
        ))}
      </ul>

      <h4>{t('exportPreviewCountsTitle')}</h4>
      <ul className="backup-preview__list" data-testid="export-preview-counts">
        {COUNT_ROWS.map((row) => (
          <li key={row.key} data-testid={`export-preview-count-${row.key}`}>
            {t(row.labelKey)}: {data.counts[row.key]}
          </li>
        ))}
      </ul>

      <div className="settings-error" role="alert" data-testid="export-sensitive-warning">
        <p>{t('exportSensitiveWarningTitle')}</p>
        <p className="settings-explainer">{t('exportSensitiveWarningDesc')}</p>
      </div>

      <div className="settings-actions">
        <button
          type="button"
          className="btn-primary"
          data-testid="export-download-btn"
          onClick={onDownload}
        >
          {t('exportDownloadBtn')}
        </button>
        <button type="button" className="btn-outline" onClick={onClose}>
          {t('exportCloseBtn')}
        </button>
      </div>

      {downloaded ? (
        <p className="settings-explainer" role="status" data-testid="export-downloaded">
          {t('exportDownloadedLabel')}
        </p>
      ) : null}
    </div>
  );
}
