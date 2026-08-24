// @vitest-environment jsdom
//
// 8.1a (docs/pr-8.1-plan.md §C 8.1a): dekt het message-gestuurde
// skipWaiting-contract vanaf de paginakant — de adapter mag `navigator.
// serviceWorker` nooit in de constructor aanraken (externe review PR #74),
// stuurt SKIP_WAITING pas na expliciete bevestiging, en herlaadt uitsluitend
// na de daaropvolgende `controllerchange` — exact één keer, nooit daarbuiten.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONTROLLERCHANGE_TIMEOUT_MS,
  detectModuleServiceWorkerSupport,
  PwaUpdateAdapter,
} from '../../src/infrastructure/pwa/PwaUpdateAdapter';

class FakeServiceWorker extends EventTarget {
  postMessage = vi.fn();
}

class FakeRegistration extends EventTarget {
  installing: FakeServiceWorker | null = null;
  waiting: FakeServiceWorker | null = null;
  active: FakeServiceWorker | null = null;
}

class FakeServiceWorkerContainer extends EventTarget {
  controller: FakeServiceWorker | null = null;
  register = vi.fn();
}

function installFakeServiceWorker(): {
  container: FakeServiceWorkerContainer;
  registration: FakeRegistration;
} {
  const container = new FakeServiceWorkerContainer();
  const registration = new FakeRegistration();
  container.register.mockResolvedValue(registration);
  vi.stubGlobal('navigator', { serviceWorker: container });
  return { container, registration };
}

describe('PwaUpdateAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('roept navigator.serviceWorker NOOIT aan in de constructor', () => {
    const guarded = new Proxy(
      {},
      {
        get() {
          throw new Error('constructor mag navigator niet aanraken');
        },
      },
    );
    vi.stubGlobal('navigator', guarded);
    expect(() => new PwaUpdateAdapter()).not.toThrow();
  });

  it('blijft idle zonder serviceWorker-ondersteuning, ook na init()', () => {
    vi.stubGlobal('navigator', {});
    const adapter = new PwaUpdateAdapter();
    adapter.init();
    expect(adapter.getState()).toEqual({ status: 'idle', registered: false });
  });

  it('registreert pas bij init(), niet bij het aanmaken', () => {
    const { container } = installFakeServiceWorker();
    const adapter = new PwaUpdateAdapter();
    expect(container.register).not.toHaveBeenCalled();
    adapter.init();
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/', type: 'module' });
  });

  it('init() is idempotent — een tweede aanroep registreert niet opnieuw', () => {
    const { container } = installFakeServiceWorker();
    const adapter = new PwaUpdateAdapter();
    adapter.init();
    adapter.init();
    expect(container.register).toHaveBeenCalledTimes(1);
  });

  it("8.1b: meldt registered: true zodra de registratie slaagt, ook zonder wachtende update ('idle', niet 'ready' als status)", async () => {
    const { registration } = installFakeServiceWorker();
    registration.waiting = null;
    const adapter = new PwaUpdateAdapter();
    adapter.init();
    await vi.waitFor(() =>
      expect(adapter.getState()).toEqual({ status: 'idle', registered: true }),
    );
  });

  it('meldt update-available zodra de registratie al een wachtende worker heeft', async () => {
    const { registration } = installFakeServiceWorker();
    registration.waiting = new FakeServiceWorker();
    const adapter = new PwaUpdateAdapter();
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('update-available'));
  });

  it('meldt update-available zodra een installerende worker "installed" wordt terwijl er al een controller is', async () => {
    const { container, registration } = installFakeServiceWorker();
    container.controller = new FakeServiceWorker();
    const adapter = new PwaUpdateAdapter();
    adapter.init();
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled());

    const installing = new FakeServiceWorker();
    let state: 'installing' | 'installed' = 'installing';
    Object.defineProperty(installing, 'state', { get: () => state });
    registration.installing = installing;
    registration.dispatchEvent(new Event('updatefound'));

    state = 'installed';
    installing.dispatchEvent(new Event('statechange'));

    expect(adapter.getState().status).toBe('update-available');
  });

  it('rapporteert een mislukte registratie als herstelbare fout', async () => {
    const container = new FakeServiceWorkerContainer();
    container.register.mockRejectedValue(new Error('boom'));
    vi.stubGlobal('navigator', { serviceWorker: container });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const adapter = new PwaUpdateAdapter();
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('error'));
  });

  it('confirmUpdate() stuurt SKIP_WAITING en herlaadt pas na controllerchange — precies één keer', async () => {
    const { container, registration } = installFakeServiceWorker();
    const waiting = new FakeServiceWorker();
    registration.waiting = waiting;
    const reload = vi.fn();
    const adapter = new PwaUpdateAdapter('/sw.js', reload);
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('update-available'));

    adapter.confirmUpdate();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(adapter.getState().status).toBe('reloading');
    expect(reload).not.toHaveBeenCalled();

    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);

    // Een tweede controllerchange (bijv. een dubbele browserfire) mag nooit
    // een tweede reload veroorzaken.
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('negeert een controllerchange die niet volgt op een eigen bevestigde SKIP_WAITING', async () => {
    const { container, registration } = installFakeServiceWorker();
    registration.waiting = new FakeServiceWorker();
    const reload = vi.fn();
    const adapter = new PwaUpdateAdapter('/sw.js', reload);
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('update-available'));

    // Geen confirmUpdate() aangeroepen — een controllerchange van een ANDERE
    // tab die zelf bijwerkt mag deze pagina nooit herladen.
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    expect(adapter.getState().status).toBe('update-available');
  });

  it('meldt een herstelbare fout als de controllerchange na bevestiging blijft uitblijven', async () => {
    const { registration } = installFakeServiceWorker();
    registration.waiting = new FakeServiceWorker();
    const reload = vi.fn();
    const adapter = new PwaUpdateAdapter('/sw.js', reload);
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('update-available'));

    // Fake timers pas NA de asynchrone registratie inschakelen — vi.waitFor
    // hierboven leunt zelf op echte timers om te pollen.
    vi.useFakeTimers();
    adapter.confirmUpdate();
    expect(adapter.getState().status).toBe('reloading');

    vi.advanceTimersByTime(CONTROLLERCHANGE_TIMEOUT_MS);
    expect(adapter.getState().status).toBe('error');
    expect(reload).not.toHaveBeenCalled();
  });

  it('retry() na een fout probeert de registratie opnieuw', async () => {
    const container = new FakeServiceWorkerContainer();
    container.register.mockRejectedValueOnce(new Error('boom'));
    vi.stubGlobal('navigator', { serviceWorker: container });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const adapter = new PwaUpdateAdapter();
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('error'));

    const registration = new FakeRegistration();
    container.register.mockResolvedValue(registration);
    adapter.retry();
    expect(container.register).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(adapter.getState().status).toBe('idle'));
  });

  it('dismissError() verbergt de fout zonder de oorzaak op te lossen', async () => {
    const container = new FakeServiceWorkerContainer();
    container.register.mockRejectedValue(new Error('boom'));
    vi.stubGlobal('navigator', { serviceWorker: container });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const adapter = new PwaUpdateAdapter();
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('error'));

    adapter.dismissError();
    expect(adapter.getState()).toEqual({ status: 'idle', registered: false });
  });

  // 8.1c (docs/pr-8.1-plan.md §C 8.1c werk 1): de capability-check bepaalt
  // welke bundel/`type` gebruikt wordt — geïnjecteerd i.p.v. via een echte
  // `Worker`-probe, zodat deze tests niet afhankelijk zijn van of jsdom
  // `Worker` implementeert.
  it('registreert de classic-fallbackbundel wanneer de capability-check geen module-ondersteuning meldt', async () => {
    const { container } = installFakeServiceWorker();
    const adapter = new PwaUpdateAdapter('/sw.js', undefined, '/sw-classic.js', () => false);
    adapter.init();
    await vi.waitFor(() =>
      expect(container.register).toHaveBeenCalledWith('/sw-classic.js', {
        scope: '/',
        type: 'classic',
      }),
    );
  });

  it('registreert de module-bundel wanneer de capability-check module-ondersteuning meldt', async () => {
    const { container } = installFakeServiceWorker();
    const adapter = new PwaUpdateAdapter('/sw.js', undefined, '/sw-classic.js', () => true);
    adapter.init();
    await vi.waitFor(() =>
      expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/', type: 'module' }),
    );
  });

  it('8.1c werk 2: meldt een herstelbare fout (later "broken" via de readinesscheck) als zelfs de classic-fallbackregistratie mislukt — geen tweede fallbackpoging, exact één register()-aanroep', async () => {
    const container = new FakeServiceWorkerContainer();
    container.register.mockRejectedValue(new Error('classic ook kapot'));
    vi.stubGlobal('navigator', { serviceWorker: container });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const adapter = new PwaUpdateAdapter('/sw.js', undefined, '/sw-classic.js', () => false);
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('error'));
    expect(container.register).toHaveBeenCalledTimes(1);
    expect(container.register).toHaveBeenCalledWith('/sw-classic.js', {
      scope: '/',
      type: 'classic',
    });
  });

  describe('detectModuleServiceWorkerSupport() — de echte capability-check', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('neemt module-ondersteuning aan als Worker hier niet bestaat (bv. jsdom)', () => {
      vi.stubGlobal('Worker', undefined);
      expect(detectModuleServiceWorkerSupport()).toBe(true);
    });

    it('detecteert GEEN module-ondersteuning als de UA de type-getter nooit uitleest', () => {
      class FakeLegacyWorker {
        constructor() {
          // Een "oude" UA leest onbekende workeropties niet uit — de
          // `type`-getter uit de probe wordt dus nooit aangeroepen.
        }
        terminate(): void {}
      }
      vi.stubGlobal('Worker', FakeLegacyWorker);
      expect(detectModuleServiceWorkerSupport()).toBe(false);
    });

    it('detecteert WEL module-ondersteuning als de UA de type-getter uitleest', () => {
      class FakeModernWorker {
        constructor(_url: string, opts: { type: string }) {
          void opts.type; // leest de getter uit, zoals een UA met module-Worker-ondersteuning doet
        }
        terminate(): void {}
      }
      vi.stubGlobal('Worker', FakeModernWorker);
      expect(detectModuleServiceWorkerSupport()).toBe(true);
    });

    it('neemt module-ondersteuning aan als de Worker-constructor zelf een throw geeft', () => {
      class FakeThrowingWorker {
        constructor() {
          throw new Error('geen Worker-ondersteuning hier');
        }
      }
      vi.stubGlobal('Worker', FakeThrowingWorker);
      expect(detectModuleServiceWorkerSupport()).toBe(true);
    });
  });

  it('subscribe() levert de huidige staat meteen en bij elke wijziging', async () => {
    const { registration } = installFakeServiceWorker();
    const adapter = new PwaUpdateAdapter();
    const seen: string[] = [];
    const unsubscribe = adapter.subscribe((s) => seen.push(s.status));
    expect(seen).toEqual(['idle']);

    adapter.init();
    registration.waiting = new FakeServiceWorker();
    await vi.waitFor(() => expect(seen).toContain('update-available'));

    unsubscribe();
    seen.length = 0;
    registration.dispatchEvent(new Event('updatefound'));
    expect(seen).toEqual([]);
  });
});
