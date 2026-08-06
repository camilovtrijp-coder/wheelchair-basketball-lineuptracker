export interface InvitationLinkParams {
  orgId: string;
  invitationId: string;
}

const ORG_ID_PARAM = 'orgId';
const INVITATION_ID_PARAM = 'invitationId';

/** Leest orgId+invitationId uit een URL-querystring (bijv. `location.search`). Geen router: eenmalig gelezen bij opstarten. */
export function parseInvitationLink(search: string): InvitationLinkParams | null {
  const params = new URLSearchParams(search);
  const orgId = params.get(ORG_ID_PARAM);
  const invitationId = params.get(INVITATION_ID_PARAM);
  if (!orgId || !invitationId) return null;
  return { orgId, invitationId };
}

/** Verwijdert de uitnodigingsparameters uit de zichtbare URL zodra de uitnodiging is afgehandeld. */
export function clearInvitationLinkFromUrl(): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', window.location.pathname);
}
