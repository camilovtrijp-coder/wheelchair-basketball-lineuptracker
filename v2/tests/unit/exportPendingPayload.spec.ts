import { describe, it, expect } from 'vitest';
import { buildPendingPayloadEnvelope } from '../../src/infrastructure/sync/exportPendingPayload';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import type { PendingAction } from '../../src/application/sync/useSyncStatus';

describe('infrastructure/sync/exportPendingPayload (PR 5.3c-2)', () => {
  it('bouwt de v1-back-up-envelop met de settings-payload onder de exacte v1-key', () => {
    const item: PendingAction = {
      kind: 'settings',
      payload: { ...DEFAULT_SETTINGS, teamName: 'Geweigerd' },
    };
    const envelope = buildPendingPayloadEnvelope(item, () => '2026-08-07T00:00:00.000Z');
    expect(envelope).toEqual({
      type: 'lineup-tracker-backup',
      version: 1,
      exportedAt: '2026-08-07T00:00:00.000Z',
      data: {
        'lineup-tracker-settings': { ...DEFAULT_SETTINGS, teamName: 'Geweigerd' },
      },
    });
  });

  it('bouwt de v1-back-up-envelop met de roster-payload onder de exacte v1-key', () => {
    const item: PendingAction = {
      kind: 'roster',
      payload: [{ id: 1, nr: '7', naam: 'Jan', kl: '3.0', vrouw: false, jeugd: false }],
    };
    const envelope = buildPendingPayloadEnvelope(item, () => '2026-08-07T00:00:00.000Z');
    expect(envelope.data).toEqual({
      'lineup-tracker-roster': [
        { id: 1, nr: '7', naam: 'Jan', kl: '3.0', vrouw: false, jeugd: false },
      ],
    });
  });

  it('exportedAt komt uit de meegegeven klok, geen andere velden lekken in de envelop', () => {
    const item: PendingAction = { kind: 'settings', payload: { ...DEFAULT_SETTINGS } };
    const envelope = buildPendingPayloadEnvelope(item, () => '2099-01-01T00:00:00.000Z');
    expect(Object.keys(envelope)).toEqual(['type', 'version', 'exportedAt', 'data']);
    expect(envelope.exportedAt).toBe('2099-01-01T00:00:00.000Z');
    expect(Object.keys(envelope.data)).toEqual(['lineup-tracker-settings']);
  });
});
