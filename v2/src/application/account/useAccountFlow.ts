import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { AccountActionGate } from './AccountActionGate';
import type {
  AccountAssessmentOutcome,
  ClearFirestoreDataOutcome,
  DeleteAuthAccountOutcome,
  ReauthFailedOutcome,
} from './AccountDeletionCoordinator';
import type { LeaveOrganizationOutcome } from './LeaveOrganizationCoordinator';

/**
 * PR 8.3c-2c-i (docs/pr-8.3c-2c-plan.md §2/§5): de flowstate van "organisatie verlaten" en
 * "account verwijderen". Leeft in `AuthGate`, BOVEN de grens waar het membership-abonnement
 * of `authUser = null` schermen laat unmounten (2b-ontwerp §C.4): een lopende aanroep en zijn
 * uitkomst overleven dus een contextwissel, een snapshot of het verdwijnen van de sessie.
 *
 * Een coördinatoraanroep start uitsluitend vanuit een expliciete gebruikersactie hieronder,
 * nooit vanuit een mount-effect; een remount van het dialoog roept dus niets opnieuw aan.
 *
 * Het wachtwoord komt alleen als argument van `submitPassword()` binnen en gaat ongewijzigd
 * naar de poort; het komt nooit in deze state.
 */
export type LeaveFlowOutcome = LeaveOrganizationOutcome | { status: 'unexpected' };

/** Uitkomsten die de verwijderflow stoppen met een melding (geen plan, geen wachtwoordvraag). */
export type AccountDeletionStopOutcome =
  | Exclude<
      AccountAssessmentOutcome | ClearFirestoreDataOutcome | DeleteAuthAccountOutcome,
      | { status: 'needs-action' }
      | { status: 'ready-to-clear' }
      | { status: 'ready-for-auth-deletion' }
      | ReauthFailedOutcome
      | { status: 'deleted' }
    >
  /** De opruiming gooide onverwacht; er kan al iets zijn verwijderd, het account bestaat nog. */
  | { status: 'unexpected' };

export type AccountDeletionPlanOutcome = Extract<
  AccountAssessmentOutcome,
  { status: 'needs-action' } | { status: 'ready-to-clear' } | { status: 'ready-for-auth-deletion' }
>;

export type AccountFlowState =
  | {
      kind: 'leave';
      step: 'confirm' | 'running';
      organizationId: string;
      organizationName: string;
    }
  | {
      kind: 'leave';
      step: 'result';
      organizationId: string;
      organizationName: string;
      outcome: LeaveFlowOutcome;
    }
  | { kind: 'delete'; step: 'assessing' }
  | { kind: 'delete'; step: 'plan'; outcome: AccountDeletionPlanOutcome; planChanged: boolean }
  | {
      kind: 'delete';
      step: 'password';
      /** `clear`: eerst Firestore opruimen, dan het account. `auth-delete`: alleen het account. */
      target: 'clear' | 'auth-delete';
      running: boolean;
      error: ReauthFailedOutcome['reason'] | null;
    }
  | { kind: 'delete'; step: 'stopped'; outcome: AccountDeletionStopOutcome }
  | { kind: 'delete'; step: 'deleted'; localWipeFailed: boolean };

export interface UseAccountFlowOptions {
  /** `null` zolang er geen accountdiensten zijn (niet ingelogd): dan opent er niets. */
  gate: AccountActionGate | null;
  /** Na "Sluiten" op een geslaagd vertrek. */
  onLeft: (organizationId: string) => void;
  /** B7: direct na `deleted`, vóór de bevestiging zichtbaar wordt. Mag gooien. */
  onAccountDeleted: () => Promise<void>;
}

export interface AccountFlowApi {
  state: AccountFlowState | null;
  openLeave: (organizationId: string, organizationName: string) => void;
  confirmLeave: () => void;
  openDelete: () => void;
  recheck: () => void;
  proceedToPassword: () => void;
  retryAuthDelete: () => void;
  submitPassword: (password: string) => void;
  close: () => void;
}

function isPlanOutcome(outcome: AccountAssessmentOutcome): outcome is AccountDeletionPlanOutcome {
  return (
    outcome.status === 'needs-action' ||
    outcome.status === 'ready-to-clear' ||
    outcome.status === 'ready-for-auth-deletion'
  );
}

/** Loopt er nu een aanroep? Dan is er niets te sluiten of opnieuw te starten. */
export function isAccountFlowRunning(state: AccountFlowState | null): boolean {
  if (state === null) return false;
  if (state.kind === 'leave') return state.step === 'running';
  return state.step === 'assessing' || (state.step === 'password' && state.running);
}

export function useAccountFlow({
  gate,
  onLeft,
  onAccountDeleted,
}: UseAccountFlowOptions): AccountFlowApi {
  const [state, setStateRaw] = useState<AccountFlowState | null>(null);
  // Synchroon bijgehouden naast de state: twee klikken in dezelfde tick zien elkaar.
  const stateRef = useRef<AccountFlowState | null>(null);
  const flowId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setState = useCallback((next: AccountFlowState | null) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  /** Alleen toepassen als het nog dezelfde flow is (na sluiten en heropenen niet meer). */
  const settle = useCallback(
    (id: number, next: AccountFlowState) => {
      if (!mounted.current || flowId.current !== id) return;
      setState(next);
    },
    [setState],
  );

  const openLeave = (organizationId: string, organizationName: string) => {
    if (gate === null || stateRef.current !== null) return;
    flowId.current += 1;
    setState({ kind: 'leave', step: 'confirm', organizationId, organizationName });
  };

  const confirmLeave = () => {
    const current = stateRef.current;
    if (gate === null || current?.kind !== 'leave' || current.step === 'running') return;
    if (current.step === 'result' && current.outcome.status === 'ok') return;
    const id = flowId.current;
    const { organizationId, organizationName } = current;
    setState({ kind: 'leave', step: 'running', organizationId, organizationName });
    void (async () => {
      let outcome: LeaveFlowOutcome;
      try {
        outcome = await gate.leave(organizationId);
      } catch {
        outcome = { status: 'unexpected' };
      }
      settle(id, { kind: 'leave', step: 'result', organizationId, organizationName, outcome });
    })();
  };

  const runAssess = (id: number, planChanged: boolean) => {
    if (gate === null) return;
    setState({ kind: 'delete', step: 'assessing' });
    void (async () => {
      let outcome: AccountAssessmentOutcome;
      try {
        outcome = await gate.assess();
      } catch {
        outcome = { status: 'failed', reason: 'read-failed' };
      }
      settle(
        id,
        isPlanOutcome(outcome)
          ? { kind: 'delete', step: 'plan', outcome, planChanged }
          : { kind: 'delete', step: 'stopped', outcome },
      );
    })();
  };

  const openDelete = () => {
    if (gate === null || stateRef.current !== null) return;
    flowId.current += 1;
    runAssess(flowId.current, false);
  };

  const recheck = () => {
    const current = stateRef.current;
    if (current?.kind !== 'delete' || (current.step !== 'plan' && current.step !== 'stopped')) {
      return;
    }
    runAssess(flowId.current, false);
  };

  const proceedToPassword = () => {
    const current = stateRef.current;
    if (current?.kind !== 'delete' || current.step !== 'plan') return;
    if (current.outcome.status === 'needs-action') return;
    setState({
      kind: 'delete',
      step: 'password',
      target: current.outcome.status === 'ready-to-clear' ? 'clear' : 'auth-delete',
      running: false,
      error: null,
    });
  };

  const retryAuthDelete = () => {
    const current = stateRef.current;
    if (
      current?.kind !== 'delete' ||
      current.step !== 'stopped' ||
      current.outcome.status !== 'firestore-cleared-auth-present'
    ) {
      return;
    }
    setState({ kind: 'delete', step: 'password', target: 'auth-delete', running: false, error: null });
  };

  const submitPassword = (password: string) => {
    const current = stateRef.current;
    if (gate === null || current?.kind !== 'delete' || current.step !== 'password') return;
    if (current.running) return;
    const id = flowId.current;
    let target = current.target;
    setState({ ...current, running: true, error: null });
    void (async () => {
      if (target === 'clear') {
        let cleared: ClearFirestoreDataOutcome | { status: 'unexpected' };
        try {
          cleared = await gate.clearFirestoreData(password);
        } catch {
          cleared = { status: 'unexpected' };
        }
        switch (cleared.status) {
          case 'ready-for-auth-deletion':
            // Eén handeling: de opruiming is bewezen leeg, nu het account zelf. De
            // coördinator reauthenticeert opnieuw en leest de eindpoort zelf opnieuw (5').
            target = 'auth-delete';
            break;
          case 'reauth-failed':
            settle(id, {
              kind: 'delete',
              step: 'password',
              target: 'clear',
              running: false,
              error: cleared.reason,
            });
            return;
          case 'needs-action':
            settle(id, { kind: 'delete', step: 'plan', outcome: cleared, planChanged: true });
            return;
          default:
            settle(id, { kind: 'delete', step: 'stopped', outcome: cleared });
            return;
        }
      }

      let deletion: DeleteAuthAccountOutcome;
      try {
        deletion = await gate.deleteAuthAccount(password);
      } catch {
        // Afloop onbekend: nooit "verwijderd", nooit "er is niets gebeurd".
        deletion = { status: 'auth-state-unknown' };
      }
      if (deletion.status === 'deleted') {
        let localWipeFailed = false;
        try {
          await onAccountDeleted();
        } catch {
          localWipeFailed = true;
        }
        settle(id, { kind: 'delete', step: 'deleted', localWipeFailed });
        return;
      }
      if (deletion.status === 'reauth-failed') {
        settle(id, {
          kind: 'delete',
          step: 'password',
          target: 'auth-delete',
          running: false,
          error: deletion.reason,
        });
        return;
      }
      settle(id, { kind: 'delete', step: 'stopped', outcome: deletion });
    })();
  };

  const close = () => {
    const current = stateRef.current;
    if (current === null || isAccountFlowRunning(current)) return;
    flowId.current += 1;
    setState(null);
    if (current.kind === 'leave' && current.step === 'result' && current.outcome.status === 'ok') {
      onLeft(current.organizationId);
    }
  };

  return {
    state,
    openLeave,
    confirmLeave,
    openDelete,
    recheck,
    proceedToPassword,
    retryAuthDelete,
    submitPassword,
    close,
  };
}
