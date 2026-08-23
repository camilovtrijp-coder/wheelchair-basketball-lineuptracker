import { describe, expect, it } from 'vitest';
import {
  deriveLegacyMigrationId,
  fnv1a,
  payloadHash,
  stableStringify,
} from '../../src/domain/migration/fingerprint';

describe('domain/migration/fingerprint (docs/pr-7.4-plan.md §C 7.4a werk 3)', () => {
  it('stableStringify negeert insertievolgorde van objectsleutels', () => {
    const a = stableStringify({ b: 1, a: 2 });
    const b = stableStringify({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('stableStringify behoudt array-volgorde (die IS betekenisvol)', () => {
    const a = stableStringify([1, 2, 3]);
    const b = stableStringify([3, 2, 1]);
    expect(a).not.toBe(b);
  });

  it('payloadHash is deterministisch voor dezelfde inhoud', () => {
    const value = { teamName: 'De Adelaars', players: [1, 2, 3] };
    expect(payloadHash(value)).toBe(payloadHash({ players: [1, 2, 3], teamName: 'De Adelaars' }));
  });

  it('payloadHash verschilt bij afwijkende inhoud', () => {
    expect(payloadHash({ x: 1 })).not.toBe(payloadHash({ x: 2 }));
  });

  it('fnv1a is stabiel en niet leeg voor een lege string', () => {
    expect(fnv1a('')).toHaveLength(8);
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });

  it('deriveLegacyMigrationId is deterministisch voor dezelfde bron/doelcombinatie (retry geen duplicaat)', () => {
    const id1 = deriveLegacyMigrationId('device-fingerprint-1', 'legacy-123', {
      organizationId: 'org1',
      teamId: 'team1',
    });
    const id2 = deriveLegacyMigrationId('device-fingerprint-1', 'legacy-123', {
      organizationId: 'org1',
      teamId: 'team1',
    });
    expect(id1).toBe(id2);
  });

  it('deriveLegacyMigrationId verschilt per doelcontext (geen kruisbesmetting tussen teams)', () => {
    const id1 = deriveLegacyMigrationId('fp', 'legacy-123', {
      organizationId: 'org1',
      teamId: 'team1',
    });
    const id2 = deriveLegacyMigrationId('fp', 'legacy-123', {
      organizationId: 'org1',
      teamId: 'team2',
    });
    expect(id1).not.toBe(id2);
  });

  it('deriveLegacyMigrationId blijft stabiel ongeacht latere content-wijziging (alleen bron-ID/context bepalen identiteit)', () => {
    // Dit is de kern van "Retry maakt geen duplicaat": twee retries van
    // DEZELFDE bron leveren hetzelfde doel-ID op, ongeacht of de payload
    // tussen de pogingen is gewijzigd — deriveLegacyMigrationId neemt de
    // content niet eens als parameter.
    const id1 = deriveLegacyMigrationId('fp', 'legacy-123', {
      organizationId: 'org1',
      teamId: 'team1',
    });
    const id2 = deriveLegacyMigrationId('fp', 'legacy-123', {
      organizationId: 'org1',
      teamId: 'team1',
    });
    expect(id1).toBe(id2);
  });
});
