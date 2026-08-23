// PR 8.1b (docs/pr-8.1-plan.md §C 8.1b werk 1/5): pure afleiding van
// `PwaReadinessStatus` uit een plat snapshot-object — geen browser-API's,
// geen adapterklasse. Test alle combinaties (`swSupported` × `adapterStatus`
// × `registered`) die de app-code daadwerkelijk kan opleveren.
import { describe, it, expect } from 'vitest';
import {
  derivePwaReadinessStatus,
  type PwaReadinessSnapshot,
} from '../../src/domain/pwa/pwaReadiness';

function snapshot(overrides: Partial<PwaReadinessSnapshot> = {}): PwaReadinessSnapshot {
  return {
    swSupported: true,
    adapterStatus: 'idle',
    registered: true,
    ...overrides,
  };
}

describe('domain/pwa/pwaReadiness: derivePwaReadinessStatus', () => {
  it("geen SW-ondersteuning → 'unsupported', ongeacht adapterstatus/registered", () => {
    expect(derivePwaReadinessStatus(snapshot({ swSupported: false }))).toEqual({
      kind: 'unsupported',
    });
    expect(
      derivePwaReadinessStatus(
        snapshot({ swSupported: false, adapterStatus: 'error', registered: false }),
      ),
    ).toEqual({ kind: 'unsupported' });
  });

  it("swSupported + adapterStatus 'error' → 'broken', ongeacht registered", () => {
    expect(
      derivePwaReadinessStatus(snapshot({ adapterStatus: 'error', registered: true })),
    ).toEqual({ kind: 'broken' });
    expect(
      derivePwaReadinessStatus(snapshot({ adapterStatus: 'error', registered: false })),
    ).toEqual({ kind: 'broken' });
  });

  it("swSupported + 'update-available'/'reloading' → 'update-pending' (blokkeert niet, zie writerClaim-tests)", () => {
    expect(derivePwaReadinessStatus(snapshot({ adapterStatus: 'update-available' }))).toEqual({
      kind: 'update-pending',
    });
    expect(derivePwaReadinessStatus(snapshot({ adapterStatus: 'reloading' }))).toEqual({
      kind: 'update-pending',
    });
  });

  it("swSupported + idle + registered: false → 'registering' (nog geen geslaagde registratie)", () => {
    expect(
      derivePwaReadinessStatus(snapshot({ adapterStatus: 'idle', registered: false })),
    ).toEqual({ kind: 'registering' });
  });

  it("swSupported + idle + registered: true → 'ready'", () => {
    expect(derivePwaReadinessStatus(snapshot({ adapterStatus: 'idle', registered: true }))).toEqual(
      { kind: 'ready' },
    );
  });
});
