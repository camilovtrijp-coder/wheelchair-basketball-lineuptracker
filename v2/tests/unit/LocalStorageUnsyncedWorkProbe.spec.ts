// PR 8.3c-2b-i — LocalStorageUnsyncedWorkProbe (docs/pr-8.3c-2b-plan.md §B.10).
// Leest alleen bestaande sleutels; fail closed bij onleesbare data. Fictieve ID's.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalStorageUnsyncedWorkProbe,
  UNKNOWN_KEYS_COUNT,
} from '../../src/infrastructure/account/LocalStorageUnsyncedWorkProbe';
import {
  listBrowserStorageKeys,
  listBrowserStorageKeysOrThrow,
  listStorageKeysOrThrow,
} from '../../src/i18n/browserStorage';
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

  // Reviewbevinding B op 2b-i: een fout bij het OPSOMMEN mag geen "0 = vertrekken mag" zijn.
  it('fail closed: sleutels niet op te sommen → onbekend, telt als onbevestigd werk', () => {
    const storage = memoryStorage({});
    const probe = new LocalStorageUnsyncedWorkProbe(storage, () => {
      throw new Error('SecurityError bij key(i)');
    });
    expect(probe.countForOrganization('org-a')).toBe(UNKNOWN_KEYS_COUNT);
    expect(UNKNOWN_KEYS_COUNT).toBeGreaterThan(0);
    expect(storage.getItem).not.toHaveBeenCalled();
  });
});

describe('listStorageKeysOrThrow / listBrowserStorageKeys (reviewbevinding B)', () => {
  function fakeStorage(keys: string[], failAt?: number): Storage {
    return {
      get length() {
        return keys.length;
      },
      key: (i: number) => {
        if (i === failAt) throw new Error('kapotte storage');
        return keys[i] ?? null;
      },
    } as unknown as Storage;
  }

  it('geeft alle sleutels', () => {
    expect(listStorageKeysOrThrow(() => fakeStorage(['a', 'b']))).toEqual(['a', 'b']);
  });

  it('geen storage (getter geeft null of gooit) → bewezen lege lijst', () => {
    expect(listStorageKeysOrThrow(() => null)).toEqual([]);
    expect(
      listStorageKeysOrThrow(() => {
        throw new Error('SecurityError');
      }),
    ).toEqual([]);
  });

  it('een fout TIJDENS het opsommen gooit door (geen stille lege lijst)', () => {
    expect(() => listStorageKeysOrThrow(() => fakeStorage(['a', 'b'], 1))).toThrow(
      'kapotte storage',
    );
  });

  it('de probe met de productie-lijstfunctie blokkeert als opsommen faalt', () => {
    const probe = new LocalStorageUnsyncedWorkProbe(memoryStorage({}), () =>
      listStorageKeysOrThrow(() => fakeStorage(['x'], 0)),
    );
    expect(probe.countForOrganization('org-a')).toBe(UNKNOWN_KEYS_COUNT);
  });

  it('listBrowserStorageKeys (wissen bij uitloggen) behoudt zijn gedrag: zonder window → []', () => {
    expect(listBrowserStorageKeys()).toEqual([]);
    expect(() => listBrowserStorageKeysOrThrow()).not.toThrow();
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
