// @vitest-environment jsdom
//
// UI-test voor de herroepbare vertrouwd-apparaat-instelling in SessionBar
// (PR 8.2c, docs/pr-8.2-plan.md §B punt 5, tweede subpunt). Bewijst:
// - de toggle toont de huidige trustedDevice-waarde;
// - aanzetten (onvertrouwd -> vertrouwd) roept onChangeTrustedDevice(true)
//   direct aan, zonder bevestigingsdialoog;
// - uitzetten (vertrouwd -> onvertrouwd) toont eerst een bevestigingsdialoog
//   i.p.v. direct onChangeTrustedDevice(false) aan te roepen;
// - bevestigen roept alsnog onChangeTrustedDevice(false) aan en sluit de
//   dialoog; annuleren roept de handler niet aan en sluit de dialoog.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { SessionBar } from '../../src/ui/context/SessionBar';

describe('ui/context/SessionBar — herroepbare vertrouwd-apparaat-instelling (PR 8.2c)', () => {
  afterEach(() => {
    cleanup();
  });

  it('toont de huidige trustedDevice-waarde in de checkbox', () => {
    render(
      <SessionBar
        lang="nl"
        onSignOut={() => {}}
        onSwitchContext={() => {}}
        trustedDevice={true}
        onChangeTrustedDevice={() => {}}
      />,
    );
    const toggle = screen.getByTestId('trusted-device-setting-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('aanzetten roept onChangeTrustedDevice(true) direct aan, zonder bevestiging', () => {
    const onChange = vi.fn();
    render(
      <SessionBar
        lang="nl"
        onSignOut={() => {}}
        onSwitchContext={() => {}}
        trustedDevice={false}
        onChangeTrustedDevice={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId('trusted-device-setting-toggle'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId('trusted-device-revoke-confirm')).toBeNull();
  });

  it('uitzetten toont eerst een bevestigingsdialoog, zonder de handler direct aan te roepen', () => {
    const onChange = vi.fn();
    render(
      <SessionBar
        lang="nl"
        onSignOut={() => {}}
        onSwitchContext={() => {}}
        trustedDevice={true}
        onChangeTrustedDevice={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId('trusted-device-setting-toggle'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('trusted-device-revoke-confirm')).not.toBeNull();
  });

  it('bevestigen roept onChangeTrustedDevice(false) aan en sluit de dialoog', () => {
    const onChange = vi.fn();
    render(
      <SessionBar
        lang="nl"
        onSignOut={() => {}}
        onSwitchContext={() => {}}
        trustedDevice={true}
        onChangeTrustedDevice={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId('trusted-device-setting-toggle'));
    fireEvent.click(screen.getByTestId('trusted-device-revoke-confirm-btn'));
    expect(onChange).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId('trusted-device-revoke-confirm')).toBeNull();
  });

  it('annuleren roept de handler niet aan en sluit de dialoog', () => {
    const onChange = vi.fn();
    render(
      <SessionBar
        lang="nl"
        onSignOut={() => {}}
        onSwitchContext={() => {}}
        trustedDevice={true}
        onChangeTrustedDevice={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId('trusted-device-setting-toggle'));
    fireEvent.click(screen.getByTestId('trusted-device-revoke-cancel-btn'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('trusted-device-revoke-confirm')).toBeNull();
  });
});
