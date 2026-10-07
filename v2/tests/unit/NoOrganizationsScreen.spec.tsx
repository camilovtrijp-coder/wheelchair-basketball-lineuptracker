// @vitest-environment jsdom
// PR 8.3c-2c-i — R6-fix (docs/pr-8.3c-2c-plan.md §6) en de ingang "account verwijderen"
// op het geen-organisatiesscherm. De gateway is een nep; `bootstrapOrgId` staat in de
// echte (jsdom-)browseropslag onder de bestaande sleutel.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/preact';
import { NoOrganizationsScreen } from '../../src/ui/onboarding/NoOrganizationsScreen';
import type { OrganizationGateway } from '../../src/application/organizations/OrganizationGateway';
import { BOOTSTRAP_ORG_ID_STORAGE_KEY } from '../../src/infrastructure/onboarding/bootstrapProgress';
import { translate } from '../../src/i18n/strings';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function gateway(overrides: Partial<Record<keyof OrganizationGateway, unknown>> = {}) {
  return {
    createOrganizationWithOwner: vi.fn(),
    createTeam: vi.fn(async () => ({ ok: true, value: { teamId: 'team-nieuw' } })),
    ...overrides,
  } as unknown as OrganizationGateway & {
    createOrganizationWithOwner: ReturnType<typeof vi.fn>;
    createTeam: ReturnType<typeof vi.fn>;
  };
}

function mount(
  gw: OrganizationGateway,
  extra: { onDeleteAccount?: () => void; busy?: boolean } = {},
) {
  const onBootstrapInFlightChange = vi.fn();
  render(
    <NoOrganizationsScreen
      lang="nl"
      reason="fresh-signup"
      organizationGateway={gw}
      onBootstrapInFlightChange={onBootstrapInFlightChange}
      onDeleteAccount={extra.onDeleteAccount}
      accountActionBusy={extra.busy}
    />,
  );
  return { onBootstrapInFlightChange };
}

function fillAndSubmit() {
  fireEvent.input(screen.getByTestId('onboarding-org-name'), { target: { value: 'Fictief Org' } });
  fireEvent.input(screen.getByTestId('onboarding-team-name'), { target: { value: 'Team A' } });
  fireEvent.click(screen.getByTestId('onboarding-submit'));
}

describe('NoOrganizationsScreen — R6', () => {
  it('permission-denied op de HERVATTING wist bootstrapOrgId; de volgende klik maakt een nieuwe organisatie', async () => {
    localStorage.setItem(BOOTSTRAP_ORG_ID_STORAGE_KEY, 'org-dood');
    const gw = gateway();
    gw.createOrganizationWithOwner
      .mockResolvedValueOnce({
        ok: false,
        errorCode: 'permission-denied',
        value: { orgId: 'org-dood' },
      })
      .mockResolvedValueOnce({ ok: true, value: { orgId: 'org-nieuw' } });
    const { onBootstrapInFlightChange } = mount(gw);

    fillAndSubmit();
    expect((await screen.findByTestId('onboarding-error')).textContent).toBe(
      translate('nl', 'onboardingResumeExpired'),
    );
    expect(gw.createOrganizationWithOwner).toHaveBeenLastCalledWith('Fictief Org', 'org-dood');
    expect(localStorage.getItem(BOOTSTRAP_ORG_ID_STORAGE_KEY)).toBeNull();
    expect(onBootstrapInFlightChange).toHaveBeenLastCalledWith(false);
    expect(gw.createTeam).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('onboarding-submit'));
    await waitFor(() => expect(gw.createTeam).toHaveBeenCalledWith('org-nieuw', 'Team A'));
    // Tweede poging: GEEN resumeOrgId meer.
    expect(gw.createOrganizationWithOwner).toHaveBeenLastCalledWith('Fictief Org', undefined);
  });

  it('een netwerkfout op de hervatting wist niets (blijft hervatten)', async () => {
    localStorage.setItem(BOOTSTRAP_ORG_ID_STORAGE_KEY, 'org-half');
    const gw = gateway();
    gw.createOrganizationWithOwner.mockResolvedValue({
      ok: false,
      errorCode: 'unavailable',
      value: { orgId: 'org-half' },
    });
    mount(gw);
    fillAndSubmit();
    expect((await screen.findByTestId('onboarding-error')).textContent).toBe(
      translate('nl', 'authGenericError'),
    );
    expect(localStorage.getItem(BOOTSTRAP_ORG_ID_STORAGE_KEY)).toBe('org-half');
    fireEvent.click(screen.getByTestId('onboarding-submit'));
    await waitFor(() => expect(gw.createOrganizationWithOwner).toHaveBeenCalledTimes(2));
    expect(gw.createOrganizationWithOwner).toHaveBeenLastCalledWith('Fictief Org', 'org-half');
  });

  it('permission-denied bij een VERSE aanmaak (geen hervatting) bewaart het orgId zoals voorheen', async () => {
    const gw = gateway();
    gw.createOrganizationWithOwner.mockResolvedValue({
      ok: false,
      errorCode: 'permission-denied',
      value: { orgId: 'org-net' },
    });
    mount(gw);
    fillAndSubmit();
    expect((await screen.findByTestId('onboarding-error')).textContent).toBe(
      translate('nl', 'authGenericError'),
    );
    expect(localStorage.getItem(BOOTSTRAP_ORG_ID_STORAGE_KEY)).toBe('org-net');
  });

  it('een geslaagde hervatting wist de sleutel pas na het team (ongewijzigd gedrag)', async () => {
    localStorage.setItem(BOOTSTRAP_ORG_ID_STORAGE_KEY, 'org-half');
    const gw = gateway();
    gw.createOrganizationWithOwner.mockResolvedValue({ ok: true, value: { orgId: 'org-half' } });
    mount(gw);
    fillAndSubmit();
    await waitFor(() => expect(gw.createTeam).toHaveBeenCalledWith('org-half', 'Team A'));
    await waitFor(() => expect(localStorage.getItem(BOOTSTRAP_ORG_ID_STORAGE_KEY)).toBeNull());
    expect(screen.queryByTestId('onboarding-error')).toBeNull();
  });
});

describe('NoOrganizationsScreen — account verwijderen', () => {
  it('zonder callback: geen sectie', () => {
    mount(gateway());
    expect(screen.queryByTestId('no-org-account-section')).toBeNull();
  });

  it('met callback: knop opent de flow; uit tijdens een lopende flow', () => {
    const onDeleteAccount = vi.fn();
    mount(gateway(), { onDeleteAccount });
    fireEvent.click(screen.getByTestId('no-org-delete-account-btn'));
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);
    cleanup();
    mount(gateway(), { onDeleteAccount, busy: true });
    expect((screen.getByTestId('no-org-delete-account-btn') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
