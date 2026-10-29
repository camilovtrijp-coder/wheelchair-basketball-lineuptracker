// @vitest-environment jsdom
//
// UI-test voor de compacte accountchip met uitklapmenu (stap 3/5, v1-look).
// Bewijst: menu is standaard dicht en toegankelijk geannoteerd; opent op klik;
// toont e-mail, wissel, vertrouwd-apparaat en uitloggen; wissel en uitloggen
// roepen hun handler aan en sluiten het menu; Escape sluit en geeft focus
// terug aan de chip; een klik buiten sluit; NL en EN labels bestaan.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { SessionBar } from '../../src/ui/context/SessionBar';

function setup(overrides: Partial<Parameters<typeof SessionBar>[0]> = {}) {
  const onSignOut = vi.fn();
  const onSwitchContext = vi.fn();
  render(
    <div>
      <SessionBar
        lang="nl"
        onSignOut={onSignOut}
        onSwitchContext={onSwitchContext}
        email="coach@voorbeeld.test"
        trustedDevice={false}
        onChangeTrustedDevice={() => {}}
        {...overrides}
      />
      <button type="button" data-testid="outside">
        buiten
      </button>
    </div>,
  );
  return { onSignOut, onSwitchContext };
}

describe('ui/context/SessionBar — accountchip en menu (stap 3/5)', () => {
  afterEach(() => {
    cleanup();
  });

  it('is standaard dicht en heeft toegankelijke menu-annotaties', () => {
    setup();
    const trigger = screen.getByTestId('account-menu-trigger');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-haspopup')).toBe('true');
    expect(trigger.getAttribute('aria-label')).toBe('Accountmenu');
    expect(screen.queryByTestId('account-menu')).toBeNull();
    expect(screen.queryByTestId('sign-out')).toBeNull();
  });

  it('toont op de chip de beginletter van het e-mailadres', () => {
    setup();
    expect(screen.getByTestId('account-menu-trigger').textContent).toContain('C');
  });

  it('opent op klik en toont e-mail, wissel, vertrouwd apparaat en uitloggen', () => {
    setup();
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    expect(screen.getByTestId('account-menu-trigger').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('session-account-email').textContent).toBe('coach@voorbeeld.test');
    expect(screen.getByTestId('switch-context').textContent).toBe('Wissel van organisatie/team');
    expect(screen.getByTestId('trusted-device-setting-toggle')).not.toBeNull();
    expect(screen.getByTestId('sign-out').textContent).toBe('Uitloggen');
  });

  it('wissel van context roept de handler aan en sluit het menu', () => {
    const { onSwitchContext } = setup();
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    fireEvent.click(screen.getByTestId('switch-context'));
    expect(onSwitchContext).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('account-menu')).toBeNull();
  });

  it('uitloggen roept de handler aan en sluit het menu', () => {
    const { onSignOut } = setup();
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    fireEvent.click(screen.getByTestId('sign-out'));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('account-menu')).toBeNull();
  });

  it('Escape sluit het menu en geeft de focus terug aan de chip', () => {
    setup();
    const trigger = screen.getByTestId('account-menu-trigger');
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('account-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('een klik buiten het menu sluit het, een klik erbinnen niet', () => {
    setup();
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    fireEvent.pointerDown(screen.getByTestId('account-menu'));
    expect(screen.queryByTestId('account-menu')).not.toBeNull();
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByTestId('account-menu')).toBeNull();
  });

  it('toont Engelse labels bij lang="en"', () => {
    setup({ lang: 'en' });
    const trigger = screen.getByTestId('account-menu-trigger');
    expect(trigger.getAttribute('aria-label')).toBe('Account menu');
    fireEvent.click(trigger);
    expect(screen.getByTestId('sign-out').textContent).toBe('Log out');
    expect(screen.getByTestId('account-menu').textContent).toContain('Signed in as');
  });

  it('toont zonder e-mailadres geen e-mailregel en een neutrale chip', () => {
    setup({ email: null });
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    expect(screen.queryByTestId('session-account-email')).toBeNull();
    expect(screen.getByTestId('account-menu-trigger').textContent).toContain('•');
  });
});
