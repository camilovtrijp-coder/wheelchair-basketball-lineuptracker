import { describe, expect, it, vi } from 'vitest';
import {
  buildDiagnosticsExport,
  sanitizeDiagnosticInput,
} from '../../src/domain/diagnostics/types';
import { InMemoryDiagnostics } from '../../src/infrastructure/diagnostics/diagnostics';

describe('diagnostics — privacygrens en in-memory buffer', () => {
  it('accepteert alleen exacte allowlistvelden en weigert persoonsgegevens/IDs/raw errors', () => {
    expect(
      sanitizeDiagnosticInput({ area: 'firebase', code: 'app-check-initialization-failed' }),
    ).toEqual({ area: 'firebase', code: 'app-check-initialization-failed' });

    expect(
      sanitizeDiagnosticInput({
        area: 'firebase',
        code: 'app-check-initialization-failed',
        email: 'player@example.test',
      }),
    ).toBeNull();
    expect(
      sanitizeDiagnosticInput({
        area: 'game',
        code: 'game-local-save-failed',
        gameId: 'game-secret',
      }),
    ).toBeNull();
    expect(
      sanitizeDiagnosticInput({
        area: 'firebase',
        code: 'unknown-code',
        error: new Error('raw'),
      }),
    ).toBeNull();
  });

  it('bewaart alleen de laatste N events en schrijft een ISO-tijd zonder browseropslag', () => {
    const times = [
      new Date('2026-08-31T10:00:00.000Z'),
      new Date('2026-08-31T10:01:00.000Z'),
      new Date('2026-08-31T10:02:00.000Z'),
    ];
    const diagnostics = new InMemoryDiagnostics(() => times.shift()!, 2);

    diagnostics.record({ area: 'settings', code: 'settings-listener-failed' });
    diagnostics.record({ area: 'roster', code: 'roster-listener-failed' });
    diagnostics.record({ area: 'pwa', code: 'pwa-update-failed' });

    expect(diagnostics.snapshot()).toEqual([
      {
        area: 'roster',
        code: 'roster-listener-failed',
        occurredAt: '2026-08-31T10:01:00.000Z',
      },
      {
        area: 'pwa',
        code: 'pwa-update-failed',
        occurredAt: '2026-08-31T10:02:00.000Z',
      },
    ]);
  });

  it('meldt updates aan subscribers en kan de sessiebuffer wissen', () => {
    const diagnostics = new InMemoryDiagnostics(() => new Date('2026-08-31T10:00:00.000Z'));
    const listener = vi.fn();
    const unsubscribe = diagnostics.subscribe(listener);
    diagnostics.record({ area: 'history', code: 'history-cloud-read-failed' });
    diagnostics.clear();
    unsubscribe();
    diagnostics.record({ area: 'history', code: 'history-delete-failed' });

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls[2]?.[0]).toEqual([]);
  });

  it('bouwt een versieerbare export zonder context- of gebruikersvelden', () => {
    const payload = buildDiagnosticsExport(
      [
        {
          area: 'game',
          code: 'game-local-save-failed',
          occurredAt: '2026-08-31T10:00:00.000Z',
        },
      ],
      new Date('2026-08-31T11:00:00.000Z'),
    );

    expect(payload).toEqual({
      type: 'lineup-tracker-diagnostics',
      version: 1,
      exportedAt: '2026-08-31T11:00:00.000Z',
      privacy: 'allowlisted-technical-codes-only',
      events: [
        {
          area: 'game',
          code: 'game-local-save-failed',
          occurredAt: '2026-08-31T10:00:00.000Z',
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toMatch(/email|uid|organizationId|teamId|gameId|player/i);
  });
});
