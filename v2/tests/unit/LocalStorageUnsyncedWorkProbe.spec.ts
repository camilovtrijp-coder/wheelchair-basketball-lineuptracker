// PR 8.3c-2b-i — LocalStorageUnsyncedWorkProbe (docs/pr-8.3c-2b-plan.md §B.10).
// Leest alleen bestaande sleutels; fail closed bij onleesbare data. Fictieve ID's.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageUnsyncedWorkProbe } from '../../src/infrastructure/account/LocalStorageUnsyncedWorkProbe';
import { activeGameStorageKey } from '../../src/infrastructure/game/LocalStorageGameRepository';
import { pendingFinalizeStorageKey } from '../../src/infrastructure/game/LocalStoragePendingFinalizeRepository';
import {
  withTimeout,
  FirebaseCallTimeoutError,
} from '../../src/infrastructure/firebase/withTimeout';

function memoryStorage(entries: Record<string, string>) {
  const data = new Map(Object.entries(entries));
  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    keys: () => [...data.keys()],
  };
}

function probeFor(entries: Record<string, string>) {
  const storage = memoryStorage(entries);
  return { storage, probe: new LocalStorageUnsyncedWorkProbe(storage, storage.keys) };
}

describe('LocalStorageUnsyncedWorkProbe', () => {
  it('telt openstaande afrondingen en een gestarte (tracking) wedstrijd van DIE organisatie', () => {
    const { probe } = probeFor({
      [pendingFinalizeStorageKey('org-a', 'team-1')]: JSON.stringify([{}, {}]),
      [pendingFinalizeStorageKey('org-a', 'team-2')]: JSON.stringify([{}]),
      [activeGameStorageKey('org-a', 'team-1')]: JSON.stringify({ phase: 'tracking' }),
      [activeGameStorageKey('org-a', 'team-2')]: JSON.stringify({ phase: 'setup' }),
    });
    expect(probe.countForOrganization('org-a')).toBe(4);
  });

  it('een opgezette maar niet gestarte wedstrijd en een lege outbox tellen niet', () => {
    const { probe } = probeFor({
      [pendingFinalizeStorageKey('org-a', 'team-1')]: '[]',
      [activeGameStorageKey('org-a', 'team-1')]: JSON.stringify({ phase: 'setup' }),
    });
    expect(probe.countForOrganization('org-a')).toBe(0);
  });

  it('kijkt alleen naar de eigen organisatie, ook bij een gedeeld ID-voorvoegsel', () => {
    const { probe } = probeFor({
      [pendingFinalizeStorageKey('org-ab', 'team-1')]: JSON.stringify([{}]),
      [activeGameStorageKey('org-b', 'team-1')]: JSON.stringify({ phase: 'tracking' }),
      'lineup-tracker-v2-settings': '{}',
    });
    expect(probe.countForOrganization('org-a')).toBe(0);
    expect(probe.countForOrganization('org-ab')).toBe(1);
    expect(probe.countForOrganization('org-b')).toBe(1);
  });

  it('fail closed: onleesbare JSON of een onverwachte vorm telt als onbevestigd werk', () => {
    const { probe } = probeFor({
      [pendingFinalizeStorageKey('org-a', 'team-1')]: '{kapot',
      [pendingFinalizeStorageKey('org-a', 'team-2')]: '{"niet":"een lijst"}',
      [activeGameStorageKey('org-a', 'team-1')]: 'ook kapot',
      [activeGameStorageKey('org-a', 'team-2')]: JSON.stringify({ phase: 'onbekend' }),
    });
    expect(probe.countForOrganization('org-a')).toBe(4);
  });

  it('fail closed: een getItem die gooit telt als onbevestigd werk', () => {
    const key = pendingFinalizeStorageKey('org-a', 'team-1');
    const probe = new LocalStorageUnsyncedWorkProbe(
      {
        getItem: () => {
          throw new Error('storage niet beschikbaar');
        },
      },
      () => [key],
    );
    expect(probe.countForOrganization('org-a')).toBe(1);
  });

  it('leest alleen: geen setItem of removeItem', () => {
    const { storage, probe } = probeFor({
      [pendingFinalizeStorageKey('org-a', 'team-1')]: JSON.stringify([{}]),
      [activeGameStorageKey('org-a', 'team-1')]: JSON.stringify({ phase: 'tracking' }),
    });
    probe.countForOrganization('org-a');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('zonder sleutels (bijv. onvertrouwd apparaat zonder cloudmodus) → 0', () => {
    expect(probeFor({}).probe.countForOrganization('org-a')).toBe(0);
  });
});

describe('withTimeout (gedeelde helper)', () => {
  afterEach(() => vi.useRealTimers());

  it('geeft de waarde of de fout van de onderliggende belofte door', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
    await expect(withTimeout(Promise.reject(new Error('x')), 1000)).rejects.toThrow('x');
  });

  it('weigert met FirebaseCallTimeoutError na de timeout', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 8000);
    const assertion = expect(pending).rejects.toBeInstanceOf(FirebaseCallTimeoutError);
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
  });
});
