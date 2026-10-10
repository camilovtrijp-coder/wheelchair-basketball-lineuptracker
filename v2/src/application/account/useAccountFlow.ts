import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { AccountActionGate } from './AccountActionGate';
import type {
  AccountAssessmentOutcome,
  ClearFirestoreDataOutcome,
  DeleteAuthAccountOutcome,
  ReauthFailedOutcome,
} from './AccountDeletionCoordinator';
import type { LeaveOrganizationOutcome } from './LeaveOrganizationCoordinator';
import type {
  CompleteTransferOutcome,
  PromoteOutcome,
  TransferCandidatesOutcome,
} from './OwnershipTransferCoordinator';
import { isSameEmailAddress, type TransferMember } from '../../domain/account/transfer';

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
 *
 * PR 8.3c-2c-ii (docs/pr-8.3c-2c-plan.md §8): ook de overdracht (`kind: 'transfer'`) leeft
 * hier. `mode: 'promote'` is stap 1 van owner A ("Eigendom overdragen"), `mode:
 * 'remove-owner'` stap 2 van owner B ("Andere eigenaar verwijderen", besluit B9, met getypte
 * bevestiging van het e-mailadres). De getypte tekst komt alleen als argument binnen.
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

/** Een lijst-uitkomst die de overdrachtsflow stopt (geen keuzelijst). */
export type TransferListStopOutcome =
  | Exclude<TransferCandidatesOutcome, { status: 'ok' }>
  | { status: 'in-progress' }
  | { status: 'unexpected' };

export type PromoteFlowOutcome = PromoteOutcome | { status: 'unexpected' };
export type CompleteTransferFlowOutcome = CompleteTransferOutcome | { status: 'unexpected' };

export type TransferMode = 'promote' | 'remove-owner';

interface TransferStateBase {
  kind: 'transfer';
  organizationId: string;
  organizationName: string;
}

export type TransferFlowState = TransferStateBase &
  (
    | { mode: TransferMode; step: 'loading' }
    | { mode: TransferMode; step: 'list-stopped'; outcome: TransferListStopOutcome }
    /** `members`: kandidaten (promote) of uitsluitend de ándere owners (remove-owner). */
    | { mode: TransferMode; step: 'choose'; members: TransferMember[] }
    | {
        mode: TransferMode;
        step: 'confirm' | 'running';
        members: TransferMember[];
        target: TransferMember;
      }
    | {
        mode: 'promote';
        step: 'result';
        members: TransferMember[];
        target: TransferMember;
        outcome: PromoteFlowOutcome;
      }
    | {
        mode: 'remove-owner';
        step: 'result';
        members: TransferMember[];
        target: TransferMember;
        outcome: CompleteTransferFlowOutcome;
      }
  );

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
  | { kind: 'delete'; step: 'deleted'; localWipeFailed: boolean }
  | TransferFlowState;

export interface UseAccountFlowOptions {
  /** `null` zolang er geen accountdiensten zijn (niet ingelogd): dan opent er niets. */
  gate: AccountActionGate | null;
  /**
   * Het uid van de ingelogde gebruiker (`null` uitgelogd). Wisselt het naar een ANDER uid
   * terwijl er een flow open staat, dan wordt die flow gesloten: een plan, organisatielijst of
   * dialoog van het vorige account hoort niet bij het nieuwe (reviewpunt A op #115). Uitloggen
   * zelf (`null`) sluit niets: de bevestiging na `deleted` staat juist over het loginscherm.
   */
  accountUid: string | null;
  /** Na "Sluiten" op een geslaagd vertrek. */
  onLeft: (organizationId: string) => void;
  /**
   * B7: direct na `deleted`, vóór de bevestiging zichtbaar wordt. Mag gooien. Krijgt de
   * organisaties uit het laatst beoordeelde verwijderplan van dit account (leeg als de
   * verwijdering zonder plan hervat), zodat het lokale opruimen (R7) alleen hun gegevens raakt.
   */
  onAccountDeleted: (organizationIds: readonly string[]) => Promise<void>;
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
  /** Overdracht openen voor één organisatie (alleen owners zien de ingang). */
  openTransfer: (organizationId: string, organizationName: string, mode: TransferMode) => void;
  /**
   * Vervangt een afgeronde flow (verlaten/verwijderen, niet tijdens een aanroep) door
   * "Eigendom overdragen" voor deze organisatie: de knop bij de owner-sole-blokkade.
   */
  switchToTransfer: (organizationId: string, organizationName: string) => void;
  reloadTransferList: () => void;
  chooseTransferTarget: (index: number) => void;
  backToTransferList: () => void;
  /**
   * Bevestigt de gekozen actie. Bij `remove-owner` MOET `typedConfirmation` het e-mailadres
   * van het doel zijn (getrimd, zonder hoofdlettergevoeligheid); anders gebeurt er niets.
   */
  confirmTransfer: (typedConfirmation?: string) => void;
  /** Dezelfde actie opnieuw na een hervatbare uitkomst (geen nieuwe invoer nodig). */
  retryTransfer: () => void;
  close: () => void;
}

/**
 * Mag dezelfde overdrachtsactie opnieuw? Alleen bij een tijdelijke of hervatbare uitkomst
 * (een verse server-lezing beslist dan opnieuw). Nooit na `ok`, `not-found` (al afgerond),
 * `not-signed-in`, `denied` of `rejected`. De UI toont "Opnieuw" precies hiermee.
 */
export function isRetryableTransferOutcome(
  outcome: PromoteFlowOutcome | CompleteTransferFlowOutcome | TransferListStopOutcome,
): boolean {
  switch (outcome.status) {
    case 'in-progress':
    case 'offline':
    case 'failed':
    case 'timeout':
    case 'incomplete':
    case 'unexpected':
      return true;
    case 'ok':
    case 'not-found':
    case 'not-signed-in':
    case 'denied':
    case 'rejected':
      return false;
  }
}

/**
 * De getypte bevestiging van B9: het e-mailadres van de andere owner, getrimd en zonder
 * hoofdlettergevoeligheid (zelfde vergelijking als het intrekken); leeg klopt nooit.
 */
export function isTransferConfirmationValid(typed: string, target: TransferMember): boolean {
  return isSameEmailAddress(typed, target.email);
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
  if (state.kind === 'transfer') return state.step === 'loading' || state.step === 'running';
  return state.step === 'assessing' || (state.step === 'password' && state.running);
}

export function useAccountFlow({
  gate,
  accountUid,
  onLeft,
  onAccountDeleted,
}: UseAccountFlowOptions): AccountFlowApi {
  const [state, setStateRaw] = useState<AccountFlowState | null>(null);
  // Synchroon bijgehouden naast de state: twee klikken in dezelfde tick zien elkaar.
  const stateRef = useRef<AccountFlowState | null>(null);
  const flowId = useRef(0);
  const deletionOrganizationIds = useRef<readonly string[]>([]);
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

  const lastUid = useRef<string | null>(null);
  useEffect(() => {
    if (accountUid === null) return;
    if (lastUid.current !== null && lastUid.current !== accountUid) {
      flowId.current += 1;
      deletionOrganizationIds.current = [];
      if (stateRef.current !== null) setState(null);
    }
    lastUid.current = accountUid;
  }, [accountUid, setState]);

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
      if (outcome.status === 'needs-action' || outcome.status === 'ready-to-clear') {
        // Binnen één flow de vereniging: een herbeoordeling na een gedeeltelijke opruiming mag
        // organisaties die al verlaten zijn niet uit de te wissen set halen.
        deletionOrganizationIds.current = [
          ...new Set([
            ...deletionOrganizationIds.current,
            ...outcome.plan.organizations.map((o) => o.organizationId),
          ]),
        ];
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
    // Een nieuwe verwijderflow begint zonder organisaties van een eerdere (mogelijk ander account).
    deletionOrganizationIds.current = [];
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
    setState({
      kind: 'delete',
      step: 'password',
      target: 'auth-delete',
      running: false,
      error: null,
    });
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
          await onAccountDeleted(deletionOrganizationIds.current);
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

  const loadTransferList = (
    id: number,
    organizationId: string,
    organizationName: string,
    mode: TransferMode,
  ) => {
    if (gate === null) return;
    setState({ kind: 'transfer', mode, step: 'loading', organizationId, organizationName });
    void (async () => {
      let outcome: TransferCandidatesOutcome | { status: 'in-progress' } | { status: 'unexpected' };
      try {
        outcome = await gate.listTransferCandidates(organizationId);
      } catch {
        outcome = { status: 'unexpected' };
      }
      const base = { kind: 'transfer' as const, mode, organizationId, organizationName };
      if (outcome.status === 'ok') {
        // B9: de B-zijde biedt UITSLUITEND andere owners aan, nooit een gewoon lid.
        const members = mode === 'promote' ? outcome.candidates : outcome.otherOwners;
        settle(id, { ...base, step: 'choose', members });
      } else {
        settle(id, { ...base, step: 'list-stopped', outcome });
      }
    })();
  };

  const openTransfer = (organizationId: string, organizationName: string, mode: TransferMode) => {
    if (gate === null || stateRef.current !== null) return;
    flowId.current += 1;
    loadTransferList(flowId.current, organizationId, organizationName, mode);
  };

  const switchToTransfer = (organizationId: string, organizationName: string) => {
    const current = stateRef.current;
    if (gate === null || current === null || isAccountFlowRunning(current)) return;
    if (current.kind === 'transfer') return;
    flowId.current += 1;
    loadTransferList(flowId.current, organizationId, organizationName, 'promote');
  };

  const reloadTransferList = () => {
    const current = stateRef.current;
    if (current?.kind !== 'transfer' || current.step !== 'list-stopped') return;
    loadTransferList(
      flowId.current,
      current.organizationId,
      current.organizationName,
      current.mode,
    );
  };

  const chooseTransferTarget = (index: number) => {
    const current = stateRef.current;
    if (current?.kind !== 'transfer' || current.step !== 'choose') return;
    const target = current.members[index];
    if (target === undefined) return;
    setState({ ...current, step: 'confirm', target });
  };

  const backToTransferList = () => {
    const current = stateRef.current;
    if (current?.kind !== 'transfer' || current.step !== 'confirm') return;
    const { kind, mode, organizationId, organizationName, members } = current;
    setState({ kind, mode, organizationId, organizationName, members, step: 'choose' });
  };

  const runTransfer = (current: {
    mode: TransferMode;
    organizationId: string;
    organizationName: string;
    members: TransferMember[];
    target: TransferMember;
  }): void => {
    if (gate === null) return;
    const id = flowId.current;
    const { mode, organizationId, organizationName, members, target } = current;
    const base = { kind: 'transfer' as const, organizationId, organizationName, members, target };
    setState({ ...base, mode, step: 'running' });
    void (async () => {
      if (mode === 'promote') {
        let outcome: PromoteFlowOutcome;
        try {
          outcome = await gate.promote(organizationId, target.uid);
        } catch {
          outcome = { status: 'unexpected' };
        }
        settle(id, { ...base, mode, step: 'result', outcome });
        return;
      }
      let outcome: CompleteTransferFlowOutcome;
      try {
        outcome = await gate.completeTransfer(organizationId, target.uid);
      } catch {
        outcome = { status: 'unexpected' };
      }
      settle(id, { ...base, mode, step: 'result', outcome });
    })();
  };

  const confirmTransfer = (typedConfirmation?: string) => {
    const current = stateRef.current;
    if (gate === null || current?.kind !== 'transfer' || current.step !== 'confirm') return;
    if (
      current.mode === 'remove-owner' &&
      !isTransferConfirmationValid(typedConfirmation ?? '', current.target)
    ) {
      return;
    }
    runTransfer(current);
  };

  const retryTransfer = () => {
    const current = stateRef.current;
    if (gate === null || current?.kind !== 'transfer' || current.step !== 'result') return;
    if (!isRetryableTransferOutcome(current.outcome)) return;
    runTransfer(current);
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
    openTransfer,
    switchToTransfer,
    reloadTransferList,
    chooseTransferTarget,
    backToTransferList,
    confirmTransfer,
    retryTransfer,
    close,
  };
}
