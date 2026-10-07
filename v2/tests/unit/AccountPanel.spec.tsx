// @vitest-environment jsdom
// PR 8.3c-2c-i — de ingang op het tabblad Instellingen: een owner krijgt de uitleg, nooit
// een verlaatknop die toch niets doet; andere rollen en team-only krijgen de knop.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { AccountPanel } from '../../src/ui/account/AccountPanel';
import { translate } from '../../src/i18n/strings';
import type { OrganizationRole } from '../../src/domain/organizations/types';

afterEach(cleanup);

function mount(role: OrganizationRole | null, busy = false, lang: 'nl' | 'en' = 'nl') {
  const onLeaveOrganization = vi.fn();
  const onDeleteAccount = vi.fn();
  render(
    <AccountPanel
      lang={lang}
      organizationName="Fictieve Adelaars"
      role={role}
      busy={busy}
      onLeaveOrganization={onLeaveOrganization}
      onDeleteAccount={onDeleteAccount}
    />,
  );
  return { onLeaveOrganization, onDeleteAccount };
}

describe('AccountPanel', () => {
  it.each(['nl', 'en'] as const)(
    'owner (%s): uitleg met organisatienaam, geen verlaatknop',
    (lang) => {
      mount('organizationOwner', false, lang);
      expect(screen.queryByTestId('leave-org-start-btn')).toBeNull();
      expect(screen.getByTestId('leave-org-owner-note').textContent).toBe(
        translate(lang, 'leaveOrgOwnerNote').replace('{org}', 'Fictieve Adelaars'),
      );
      expect(screen.getByTestId('account-delete-start-btn')).toBeTruthy();
    },
  );

  it.each(['organizationAdmin', 'coach', 'scorer', 'viewer', null] as const)(
    '%s: verlaatknop opent de flow; account verwijderen ook',
    (role) => {
      const { onLeaveOrganization, onDeleteAccount } = mount(role);
      expect(screen.queryByTestId('leave-org-owner-note')).toBeNull();
      fireEvent.click(screen.getByTestId('leave-org-start-btn'));
      expect(onLeaveOrganization).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByTestId('account-delete-start-btn'));
      expect(onDeleteAccount).toHaveBeenCalledTimes(1);
    },
  );

  it('tijdens een lopende flow staan beide knoppen uit', () => {
    const { onLeaveOrganization } = mount('coach', true);
    const leave = screen.getByTestId('leave-org-start-btn') as HTMLButtonElement;
    expect(leave.disabled).toBe(true);
    expect((screen.getByTestId('account-delete-start-btn') as HTMLButtonElement).disabled).toBe(
      true,
    );
    // (Een gedispatchte klik op een uitgeschakelde knop komt in jsdom wél door; de hook
    // weigert dan zelf een tweede flow — zie AccountFlowDialog.spec "één ingang".)
    expect(onLeaveOrganization).not.toHaveBeenCalled();
  });
});
