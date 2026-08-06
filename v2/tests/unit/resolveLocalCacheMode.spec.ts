import { describe, it, expect } from 'vitest';
import { resolveLocalCacheMode } from '../../src/infrastructure/firebase/firebaseClient';

describe('infrastructure/firebase/firebaseClient — resolveLocalCacheMode', () => {
  it('schakelt persistente IndexedDb-cache in op een vertrouwd apparaat', () => {
    expect(resolveLocalCacheMode(true).kind).toBe('persistent');
  });

  it('gebruikt geheugen-only cache op een niet-vertrouwd apparaat (geen lokale sporen)', () => {
    expect(resolveLocalCacheMode(false).kind).toBe('memory');
  });
});
