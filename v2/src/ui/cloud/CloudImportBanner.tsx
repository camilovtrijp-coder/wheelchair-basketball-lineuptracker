// Discrete banner boven SettingsPanel/RosterPanel met de "Eenmalig naar
// cloud kopiëren"-knop (PR 5.3b). Verschijnt uitsluitend wanneer de
// bovenliggende component een `onMigrate`-handler doorgeeft — 5.3b laat
// deze prop standaard undefined, zodat de banner dormant is; 5.3c wired
// de handler zodra de UI volledig async draait. Bewust NIET in AuthGate
// geplaatst: data-migratie is geen routering-state (zie plan §C/5.3b
// review-correctie punt 3).

import { useState } from 'preact/hooks';
import { translate, type Lang } from '../../i18n/strings';
import type { KeyValueStorage } from '../../i18n/persistence';
import { isCloudImported } from '../../infrastructure/cloudImportFlag';

export interface CloudImportBannerProps {
  lang: Lang;
  storage: KeyValueStorage;
  kind: 'settings' | 'roster';
  /**
   * De daadwerkelijke migratieaanroep. Wanneer undefined toont de banner
   * niets — dat is het dormant-pad in 5.3b vóór 5.3c-wiring.
   */
  onMigrate?: () => Promise<{ ok: boolean; errors: string[] }>;
}

type Status = 'idle' | 'running' | 'success' | 'error';

export function CloudImportBanner({ lang, storage, kind, onMigrate }: CloudImportBannerProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!onMigrate) return null;
  if (isCloudImported(storage, kind) && status === 'idle') return null;

  async function handleClick() {
    if (!onMigrate) return;
    setStatus('running');
    setErrorMsg(null);
    try {
      const result = await onMigrate();
      setStatus(result.ok ? 'success' : 'error');
      if (!result.ok) {
        setErrorMsg(result.errors.join('; ') || translate(lang, 'cloudImportError'));
      }
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : translate(lang, 'cloudImportError'));
    }
  }

  const prompt = translate(lang, 'cloudImportPrompt');
  const buttonLabel = translate(lang, 'cloudImportButton');
  const alreadyDone = translate(lang, 'cloudImportAlreadyDone');
  const success = translate(lang, 'cloudImportSuccess');
  const errorLabel = translate(lang, 'cloudImportError');
  const testId = `cloud-import-banner-${kind}`;

  return (
    <section className="cloud-import-banner" aria-label={prompt} data-testid={testId}>
      <p className="cloud-import-banner__prompt">
        {status === 'success' ? success : status === 'error' && !errorMsg ? errorLabel : prompt}
      </p>
      {status === 'success' ? (
        <p className="cloud-import-banner__done" data-testid={`${testId}-done`}>
          {alreadyDone}
        </p>
      ) : (
        <button
          type="button"
          className="btn-outline"
          data-testid={`${testId}-button`}
          disabled={status === 'running'}
          onClick={handleClick}
        >
          {buttonLabel}
        </button>
      )}
      {status === 'error' && errorMsg ? (
        <p className="cloud-import-banner__error" role="alert" data-testid={`${testId}-error`}>
          {errorMsg}
        </p>
      ) : null}
    </section>
  );
}
