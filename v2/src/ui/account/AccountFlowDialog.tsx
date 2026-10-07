// PR 8.3c-2c-i (docs/pr-8.3c-2c-plan.md §2/§5): het dialoog voor "organisatie verlaten" en
// "account verwijderen". Puur presentatie: alle state en elke coördinatoraanroep zitten in
// `useAccountFlow` (in `AuthGate`, boven de unmount-grens); dit dialoog roept zelf nooit
// iets aan bij mount. Zelfde structuurpatroon als `DeletionConfirmDialog`: backdrop-klik en
// Escape sluiten, `useFocusTrap` vangt de focus en geeft die bij sluiten terug, en tijdens
// een lopende aanroep sluit niets het dialoog.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { useFocusTrap } from '../../application/a11y/useFocusTrap';
import {
  isAccountFlowRunning,
  type AccountFlowApi,
  type AccountFlowState,
} from '../../application/account/useAccountFlow';
import { isSelfResolvable } from '../../domain/account/classify';
import {
  deletionClassLine,
  deletionStopView,
  formatLine,
  leaveOutcomeView,
  reauthErrorKey,
  type MessageLine,
} from './accountFlowMessages';

export interface AccountFlowDialogProps {
  lang: Lang;
  flow: AccountFlowApi;
  /** Weergavenaam voor een organisatie in het plan; valt terug op de ID. */
  organizationName: (organizationId: string) => string;
  /** Bevestigingsmail opnieuw sturen (bij `email-not-verified`); `false` = mislukt. */
  onResendVerification?: () => Promise<boolean>;
}

export function AccountFlowDialog(props: AccountFlowDialogProps) {
  if (props.flow.state === null) return null;
  return <AccountFlowModal {...props} state={props.flow.state} />;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Lines({
  lang,
  lines,
  testId,
  tone,
}: {
  lang: Lang;
  lines: MessageLine[];
  testId: string;
  tone: 'success' | 'error' | 'info';
}) {
  return (
    <div
      className={tone === 'error' ? 'settings-error' : 'settings-explainer'}
      role={tone === 'error' ? 'alert' : 'status'}
      data-testid={testId}
    >
      {lines.map((line) => (
        <p key={line.key}>{formatLine(lang, line)}</p>
      ))}
    </div>
  );
}

function AccountFlowModal({
  lang,
  flow,
  state,
  organizationName,
  onResendVerification,
}: AccountFlowDialogProps & { state: AccountFlowState }) {
  const t = (key: StringKey): string => translate(lang, key);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const running = isAccountFlowRunning(state);
  const close = () => {
    if (!running) flow.close();
  };

  // Bij elke stapwissel verdwijnt de knop die focus had: zet de focus op het eerste
  // focusbare element van de nieuwe stap (bij mount doet `useFocusTrap` dat al).
  const stepKey = `${state.kind}:${state.step}:${String(running)}`;
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const container = trapRef.current;
    if (!container) return;
    const first = container.querySelector<HTMLElement>(FOCUSABLE);
    if (first) first.focus();
    else container.focus();
  }, [stepKey]);

  const title =
    state.kind === 'leave'
      ? formatLine(lang, { key: 'leaveOrgConfirmTitle', params: { org: state.organizationName } })
      : state.step === 'password'
        ? t('accountDeletePasswordTitle')
        : t('accountDeleteTitle');

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="modal-overlay"
      role="dialog"
      aria-label={title}
      aria-modal="true"
      data-testid="account-flow-dialog"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className="modal"
        role="document"
        ref={trapRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        {state.kind === 'leave' ? (
          <LeaveContent lang={lang} flow={flow} state={state} />
        ) : (
          <DeleteContent
            lang={lang}
            flow={flow}
            state={state}
            organizationName={organizationName}
            onResendVerification={onResendVerification}
          />
        )}
      </div>
    </div>
  );
}

function LeaveContent({
  lang,
  flow,
  state,
}: {
  lang: Lang;
  flow: AccountFlowApi;
  state: Extract<AccountFlowState, { kind: 'leave' }>;
}) {
  const t = (key: StringKey): string => translate(lang, key);
  if (state.step === 'result') {
    const view = leaveOutcomeView(state.outcome, state.organizationName);
    return (
      <>
        <Lines lang={lang} lines={view.lines} tone={view.tone} testId="leave-org-result" />
        <div className="settings-actions">
          {view.canRetry ? (
            <button
              type="button"
              className="btn-primary"
              data-testid="leave-org-retry-btn"
              onClick={flow.confirmLeave}
            >
              {t('accountRetryBtn')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn-outline"
            data-testid="leave-org-close-btn"
            onClick={flow.close}
          >
            {t('accountCloseBtn')}
          </button>
        </div>
      </>
    );
  }
  const running = state.step === 'running';
  return (
    <>
      <p className="modal__desc">{t('leaveOrgConfirmDesc')}</p>
      <div className="settings-actions">
        <button
          type="button"
          className="btn-primary"
          data-testid="leave-org-confirm-btn"
          disabled={running}
          onClick={flow.confirmLeave}
        >
          {running ? t('leaveOrgInProgress') : t('leaveOrgConfirmBtn')}
        </button>
        <button
          type="button"
          className="btn-outline"
          data-testid="leave-org-back-btn"
          disabled={running}
          onClick={flow.close}
        >
          {t('accountBackBtn')}
        </button>
      </div>
    </>
  );
}

function DeleteContent({
  lang,
  flow,
  state,
  organizationName,
  onResendVerification,
}: {
  lang: Lang;
  flow: AccountFlowApi;
  state: Extract<AccountFlowState, { kind: 'delete' }>;
  organizationName: (organizationId: string) => string;
  onResendVerification?: () => Promise<boolean>;
}) {
  const t = (key: StringKey): string => translate(lang, key);
  const closeButton = (
    <button
      type="button"
      className="btn-outline"
      data-testid="account-delete-close-btn"
      onClick={flow.close}
    >
      {t('accountCloseBtn')}
    </button>
  );

  switch (state.step) {
    case 'assessing':
      return (
        <p className="settings-explainer" role="status" data-testid="account-delete-checking">
          {t('accountDeleteChecking')}
        </p>
      );

    case 'plan': {
      const { outcome } = state;
      return (
        <>
          {state.planChanged ? (
            <p className="settings-error" role="alert" data-testid="account-delete-plan-changed">
              {t('accountDeletePlanChanged')}
            </p>
          ) : null}
          {outcome.status === 'ready-for-auth-deletion' ? (
            <p className="settings-explainer" data-testid="account-delete-auth-only">
              {t('accountDeleteAuthOnly')}
            </p>
          ) : (
            <>
              <p className="settings-explainer">{t('accountDeletePlanIntro')}</p>
              <ul className="backup-preview__list" data-testid="account-delete-plan">
                {outcome.plan.organizations.map((entry) => (
                  <li
                    key={entry.organizationId}
                    data-testid={`account-delete-org-${entry.organizationId}`}
                    data-blocked={String(!isSelfResolvable(entry.class))}
                  >
                    <strong>{organizationName(entry.organizationId)}</strong>:{' '}
                    {formatLine(lang, deletionClassLine(entry))}
                  </li>
                ))}
              </ul>
              <p className="settings-explainer" data-testid="account-delete-invitations">
                {formatLine(lang, {
                  key: 'accountDeleteInvitations',
                  params: { count: outcome.plan.invitationCount },
                })}
              </p>
              {outcome.status === 'needs-action' ? (
                <p className="settings-error" role="alert" data-testid="account-delete-blocked">
                  {t('accountDeleteBlockedTitle')}
                </p>
              ) : (
                <p className="settings-explainer" data-testid="account-delete-ready">
                  {t('accountDeleteReadyIntro')}
                </p>
              )}
            </>
          )}
          <div className="settings-actions">
            {outcome.status === 'needs-action' ? (
              <button
                type="button"
                className="btn-primary"
                data-testid="account-delete-recheck-btn"
                onClick={flow.recheck}
              >
                {t('accountDeleteRecheckBtn')}
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                data-testid="account-delete-continue-btn"
                onClick={flow.proceedToPassword}
              >
                {t('accountDeleteContinueBtn')}
              </button>
            )}
            {closeButton}
          </div>
        </>
      );
    }

    case 'password':
      return (
        <PasswordForm
          lang={lang}
          running={state.running}
          errorKey={state.error === null ? null : reauthErrorKey(state.error)}
          onSubmit={flow.submitPassword}
          onCancel={flow.close}
        />
      );

    case 'stopped': {
      const view = deletionStopView(state.outcome);
      return (
        <>
          <Lines lang={lang} lines={view.lines} tone={view.tone} testId="account-delete-result" />
          {view.offerVerificationMail && onResendVerification ? (
            <ResendVerification lang={lang} onResend={onResendVerification} />
          ) : null}
          <div className="settings-actions">
            {view.retry !== null ? (
              <button
                type="button"
                className="btn-primary"
                data-testid="account-delete-retry-btn"
                onClick={view.retry === 'auth-delete' ? flow.retryAuthDelete : flow.recheck}
              >
                {t('accountRetryBtn')}
              </button>
            ) : null}
            {closeButton}
          </div>
        </>
      );
    }

    case 'deleted':
      return (
        <>
          <Lines
            lang={lang}
            tone="success"
            testId="account-delete-deleted"
            lines={[
              { key: 'accountDeleteDeleted' },
              ...(state.localWipeFailed ? [{ key: 'accountDeleteLocalWipeFailed' as const }] : []),
            ]}
          />
          <div className="settings-actions">{closeButton}</div>
        </>
      );
  }
}

/**
 * Het wachtwoord leeft ALLEEN hier, in lokale componentstate, en wordt bij versturen meteen
 * leeggemaakt: het komt nooit in de flowstate, een uitkomst, een log of browseropslag.
 */
function PasswordForm({
  lang,
  running,
  errorKey,
  onSubmit,
  onCancel,
}: {
  lang: Lang;
  running: boolean;
  errorKey: StringKey | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const t = (key: StringKey): string => translate(lang, key);
  const [password, setPassword] = useState('');
  const submit = (event: JSX.TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (running || password === '') return;
    const value = password;
    setPassword('');
    onSubmit(value);
  };
  return (
    <form onSubmit={submit} data-testid="account-delete-password-form">
      <p className="modal__desc">{t('accountDeletePasswordDesc')}</p>
      <label className="settings-field">
        <span className="settings-field__label">{t('accountDeletePasswordLabel')}</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={running}
          data-testid="account-delete-password-input"
          onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      {errorKey !== null ? (
        <p className="settings-error" role="alert" data-testid="account-delete-password-error">
          {t(errorKey)}
        </p>
      ) : null}
      <div className="settings-actions">
        <button
          type="submit"
          className="btn-primary"
          data-testid="account-delete-confirm-btn"
          disabled={running || password === ''}
        >
          {running ? t('accountDeleteInProgress') : t('accountDeleteConfirmBtn')}
        </button>
        <button
          type="button"
          className="btn-outline"
          data-testid="account-delete-cancel-btn"
          disabled={running}
          onClick={onCancel}
        >
          {t('accountBackBtn')}
        </button>
      </div>
    </form>
  );
}

function ResendVerification({
  lang,
  onResend,
}: {
  lang: Lang;
  onResend: () => Promise<boolean>;
}) {
  const t = (key: StringKey): string => translate(lang, key);
  const [result, setResult] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const send = async () => {
    setResult('sending');
    let ok = false;
    try {
      ok = await onResend();
    } catch {
      ok = false;
    }
    if (mounted.current) setResult(ok ? 'sent' : 'failed');
  };
  return (
    <div className="settings-actions">
      <button
        type="button"
        className="btn-outline"
        data-testid="account-delete-resend-verification-btn"
        disabled={result === 'sending'}
        onClick={() => void send()}
      >
        {t('accountDeleteResendVerificationBtn')}
      </button>
      {result === 'sent' || result === 'failed' ? (
        <span role="status" data-testid="account-delete-verification-result">
          {t(result === 'sent' ? 'accountDeleteVerificationSent' : 'accountDeleteVerificationFailed')}
        </span>
      ) : null}
    </div>
  );
}
