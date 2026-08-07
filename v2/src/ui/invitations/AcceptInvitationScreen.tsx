import { useEffect, useState } from 'preact/hooks';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import type { AuthUser } from '../../domain/auth/types';
import type { Invitation } from '../../domain/invitations/types';
import type { OrganizationGateway } from '../../application/organizations/OrganizationGateway';
import type { InvitationLinkParams } from '../../infrastructure/invitations/invitationLink';

export interface AcceptInvitationScreenProps {
  lang: Lang;
  authUser: AuthUser;
  link: InvitationLinkParams;
  organizationGateway: OrganizationGateway;
  /** Aangeroepen zodra het lidmaatschap succesvol is geclaimd — de aanroeper ververst memberships en sluit dit scherm. */
  onResolved: () => void;
  onDismiss: () => void;
  onResendVerification: () => Promise<boolean>;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

function Screen({
  titleKey,
  bodyKey,
  bodyTestId,
  onDismiss,
  lang,
}: {
  titleKey: StringKey;
  bodyKey: StringKey;
  bodyTestId: string;
  onDismiss: () => void;
  lang: Lang;
}) {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">{t(lang, titleKey)}</h1>
      </header>
      <main className="app-main">
        <p data-testid={bodyTestId}>{t(lang, bodyKey)}</p>
        <button type="button" data-testid="invitation-dismiss" onClick={onDismiss}>
          {t(lang, 'invitationDismissBtn')}
        </button>
      </main>
    </div>
  );
}

export function AcceptInvitationScreen({
  lang,
  authUser,
  link,
  organizationGateway,
  onResolved,
  onDismiss,
  onResendVerification,
}: AcceptInvitationScreenProps) {
  const [invitation, setInvitation] = useState<Invitation | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    organizationGateway.getInvitationByLink(link.orgId, link.invitationId).then((result) => {
      if (!cancelled) setInvitation(result);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationGateway, link.orgId, link.invitationId]);

  async function handleAccept() {
    setSubmitting(true);
    setError(null);
    const result = await organizationGateway.acceptInvitation(link.orgId, link.invitationId);
    if (!result.ok) {
      setSubmitting(false);
      setError(t(lang, 'authGenericError'));
      return;
    }
    const refreshed = await organizationGateway.getInvitationByLink(link.orgId, link.invitationId);
    setSubmitting(false);
    setInvitation(refreshed);
  }

  async function handleClaim() {
    if (!invitation) return;
    setSubmitting(true);
    setError(null);
    const result = await organizationGateway.claimInvitation(invitation);
    setSubmitting(false);
    if (!result.ok) {
      setError(t(lang, 'authGenericError'));
      return;
    }
    onResolved();
  }

  if (invitation === undefined) {
    return (
      <div className="app">
        <main className="app-main">
          <p data-testid="loading-screen">{t(lang, 'authLoadingTitle')}</p>
        </main>
      </div>
    );
  }

  if (invitation === null) {
    return (
      <Screen
        lang={lang}
        titleKey="invitationNotFoundTitle"
        bodyKey="invitationNotFoundBody"
        bodyTestId="invitation-not-found-body"
        onDismiss={onDismiss}
      />
    );
  }

  if (invitation.status === 'revoked') {
    return (
      <Screen
        lang={lang}
        titleKey="invitationRevokedTitle"
        bodyKey="invitationRevokedBody"
        bodyTestId="invitation-revoked-body"
        onDismiss={onDismiss}
      />
    );
  }

  if (invitation.status === 'claimed') {
    return (
      <Screen
        lang={lang}
        titleKey="invitationAlreadyClaimedTitle"
        bodyKey="invitationAlreadyClaimedBody"
        bodyTestId="invitation-claimed-body"
        onDismiss={onDismiss}
      />
    );
  }

  if (invitation.status === 'pending' && !authUser.emailVerified) {
    return (
      <div className="app">
        <header className="app-header">
          <h1 className="app-title">{t(lang, 'authVerifyEmailTitle')}</h1>
        </header>
        <main className="app-main">
          <p data-testid="invitation-verify-email-body">{t(lang, 'authVerifyEmailBody')}</p>
          <button
            type="button"
            data-testid="invitation-resend-verification"
            onClick={() => void onResendVerification()}
          >
            {t(lang, 'authResendVerificationBtn')}
          </button>
        </main>
      </div>
    );
  }

  if (invitation.status === 'pending') {
    return (
      <div className="app">
        <header className="app-header">
          <h1 className="app-title">{t(lang, 'invitationAcceptTitle')}</h1>
        </header>
        <main className="app-main">
          <p data-testid="invitation-pending-body">
            {t(lang, 'invitationPendingBody')} {invitation.role}
          </p>
          {error ? (
            <p className="auth-form__error" role="alert" data-testid="invitation-error">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            data-testid="invitation-accept"
            disabled={submitting}
            onClick={handleAccept}
          >
            {t(lang, 'invitationAcceptBtn')}
          </button>
        </main>
      </div>
    );
  }

  // invitation.status === 'accepted'
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">{t(lang, 'invitationClaimTitle')}</h1>
      </header>
      <main className="app-main">
        <p data-testid="invitation-accepted-body">{t(lang, 'invitationAcceptedBody')}</p>
        {error ? (
          <p className="auth-form__error" role="alert" data-testid="invitation-error">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          data-testid="invitation-claim"
          disabled={submitting}
          onClick={handleClaim}
        >
          {t(lang, 'invitationClaimBtn')}
        </button>
      </main>
    </div>
  );
}
