import { describe, it, expect } from 'vitest';
import { deriveSyncState } from '../../src/domain/syncState';

describe('domain/syncState — deriveSyncState', () => {
  it('hasPendingWrites → wacht-op-synchronisatie', () => {
    const out = deriveSyncState({ fromCache: false, hasPendingWrites: true });
    expect(out.status).toBe('wacht-op-synchronisatie');
    expect(out.hasPendingWrites).toBe(true);
  });

  it('fromCache zonder pending writes → lokaal-beschikbaar', () => {
    const out = deriveSyncState({ fromCache: true, hasPendingWrites: false });
    expect(out.status).toBe('lokaal-beschikbaar');
    expect(out.fromCache).toBe(true);
  });

  it('serverbron zonder pending writes → gesynchroniseerd', () => {
    const out = deriveSyncState({ fromCache: false, hasPendingWrites: false });
    expect(out.status).toBe('gesynchroniseerd');
  });

  it(
    'pending writes winnen het van fromCache (cache is mogelijk verouderd, ' +
      'server-bevestiging nog niet binnen)',
    () => {
      const out = deriveSyncState({ fromCache: true, hasPendingWrites: true });
      expect(out.status).toBe('wacht-op-synchronisatie');
    },
  );

  it(
    'actie-nodig wordt NIET afgeleid uit metadata — die status zetten adapters ' +
      'expliciet bij geweigerde write',
    () => {
      // Geen combinatie van fromCache/hasPendingWrites levert 'actie-nodig' op.
      const cases = [
        { fromCache: false, hasPendingWrites: false },
        { fromCache: true, hasPendingWrites: false },
        { fromCache: false, hasPendingWrites: true },
        { fromCache: true, hasPendingWrites: true },
      ];
      for (const meta of cases) {
        expect(deriveSyncState(meta).status).not.toBe('actie-nodig');
      }
    },
  );
});
