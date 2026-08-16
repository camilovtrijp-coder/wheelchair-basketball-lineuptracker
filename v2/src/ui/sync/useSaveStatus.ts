import { useEffect, useRef, useState } from 'preact/hooks';

export type SaveStatus = { kind: 'idle' } | { kind: 'success' } | { kind: 'error'; message: string };

/**
 * Gedeelde opslaan-bevestigingsstatus (PR 5.5c-bugfixes bug 2): `handleSave()`
 * op Roster-/Instellingen-tab gaf voorheen alleen bij een MISLUKTE write
 * feedback (inline foutmelding) — een geslaagde save leverde geen enkele
 * zichtbare bevestiging op, in tegenstelling tot `BackupPanel`'s expliciete
 * idle→running→done-status. `notifySuccess()` toont een korte, automatisch
 * verdwijnende bevestiging (een routine save per veldwijziging hoeft niet
 * expliciet weggeklikt te worden, anders dan een backup-import);
 * `notifyError()` blijft zichtbaar tot de volgende save-poging, zoals de
 * bestaande foutmeldingen al deden.
 */
export function useSaveStatus(successDurationMs = 2500) {
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  function clearTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function notifySuccess() {
    clearTimer();
    setStatus({ kind: 'success' });
    timerRef.current = setTimeout(() => setStatus({ kind: 'idle' }), successDurationMs);
  }

  function notifyError(message: string) {
    clearTimer();
    setStatus({ kind: 'error', message });
  }

  function reset() {
    clearTimer();
    setStatus({ kind: 'idle' });
  }

  return { status, notifySuccess, notifyError, reset };
}
