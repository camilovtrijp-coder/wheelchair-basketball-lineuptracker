import { useEffect, useState } from 'preact/hooks';
import type { DiagnosticsPort } from '../../application/diagnostics/DiagnosticsPort';
import type { DiagnosticEvent } from '../../domain/diagnostics/types';
import { translate, type Lang } from '../../i18n/strings';
import { downloadDiagnostics } from '../../infrastructure/diagnostics/diagnostics';

export interface DiagnosticsPanelProps {
  lang: Lang;
  diagnostics: DiagnosticsPort;
}

export function DiagnosticsPanel({ lang, diagnostics }: DiagnosticsPanelProps) {
  const [events, setEvents] = useState<readonly DiagnosticEvent[]>(() => diagnostics.snapshot());

  useEffect(() => diagnostics.subscribe(setEvents), [diagnostics]);

  return (
    <section className="settings-section" aria-labelledby="diagnostics-title">
      <h2 id="diagnostics-title">{translate(lang, 'diagnosticsTitle')}</h2>
      <p className="settings-explainer">{translate(lang, 'diagnosticsDesc')}</p>
      <p className="settings-explainer" data-testid="diagnostics-privacy-note">
        {translate(lang, 'diagnosticsPrivacy')}
      </p>
      <p role="status" aria-live="polite" data-testid="diagnostics-count">
        {translate(lang, 'diagnosticsCount').replace('{count}', String(events.length))}
      </p>
      <div className="settings-actions">
        <button
          type="button"
          className="btn-outline"
          data-testid="diagnostics-download"
          disabled={events.length === 0}
          onClick={() => downloadDiagnostics(events)}
        >
          {translate(lang, 'diagnosticsDownloadBtn')}
        </button>
        <button
          type="button"
          className="btn-outline"
          data-testid="diagnostics-clear"
          disabled={events.length === 0}
          onClick={() => diagnostics.clear()}
        >
          {translate(lang, 'diagnosticsClearBtn')}
        </button>
      </div>
    </section>
  );
}
