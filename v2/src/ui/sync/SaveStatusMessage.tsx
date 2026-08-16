import { translate, type Lang } from '../../i18n/strings';
import type { SaveStatus } from './useSaveStatus';

/**
 * Gedeelde weergave voor `useSaveStatus()` (PR 5.5c-bugfixes bug 2). Behoudt
 * de bestaande `${testIdPrefix}-error`-testid (Roster-/Instellingen-e2e-tests
 * verwachten die al) en voegt een nieuwe `${testIdPrefix}-save-success`-
 * indicator toe voor de tot nu toe ontbrekende succesbevestiging.
 */
export function SaveStatusMessage({
  lang,
  status,
  testIdPrefix,
}: {
  lang: Lang;
  status: SaveStatus;
  testIdPrefix: string;
}) {
  if (status.kind === 'success') {
    return (
      <p className="settings-success" role="status" data-testid={`${testIdPrefix}-save-success`}>
        {translate(lang, 'saveSuccessMessage')}
      </p>
    );
  }
  if (status.kind === 'error') {
    return (
      <p className="settings-error" role="alert" data-testid={`${testIdPrefix}-error`}>
        {status.message}
      </p>
    );
  }
  return null;
}
