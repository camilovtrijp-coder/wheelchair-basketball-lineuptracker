// @vitest-environment jsdom
//
// Diagnose bij een mislukte service-workerregistratie of uitblijvende
// controllerchange: het adapter-state krijgt een compact, veilig
// `errorDetail` zodat de foutmelding op een telefoon als screenshot gedeeld
// kan worden. Dekt: registratiefout, timeout-fout, de same-origin
// fetch-probe (ook een redirect) en een probe die zelf faalt.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONTROLLERCHANGE_TIMEOUT_MS,
  PwaUpdateAdapter,
} from '../../src/infrastructure/pwa/PwaUpdateAdapter';
import {
  formatPwaErrorDetail,
  PWA_ERROR_TEXT_MAX,
  truncateDiagnosticText,
} from '../../src/domain/pwa/pwaErrorDetail';

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

function stubContainer(): FakeServiceWorkerContainer {
  const container = new FakeServiceWorkerContainer();
  vi.stubGlobal('navigator', { serviceWorker: container });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return container;
}

function fakeResponse(init: {
  status: number;
  type: string;
  contentType: string | null;
  redirected?: boolean;
}): Response {
  return {
    status: init.status,
    type: init.type,
    redirected: init.redirected ?? false,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? init.contentType : null),
    },
  } as unknown as Response;
}

describe('PwaUpdateAdapter errorDetail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registratiefout: legt fase, script, type en foutnaam/-melding vast', async () => {
    const container = stubContainer();
    const err = new Error('The script has an unsupported MIME type');
    err.name = 'SecurityError';
    container.register.mockRejectedValue(err);
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('x'));

    const adapter = new PwaUpdateAdapter(
      '/sw.js',
      () => undefined,
      '/sw-classic.js',
      () => true,
      fetchFn,
    );
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('error'));

    const detail = adapter.getState().errorDetail;
    expect(detail).toMatchObject({
      phase: 'register',
      swUrl: '/sw.js',
      swType: 'module',
      errorName: 'SecurityError',
      errorMessage: 'The script has an unsupported MIME type',
    });
  });

  it('kiest de classic-URL en -type in het detail als de capability-check classic geeft', async () => {
    const container = stubContainer();
    container.register.mockRejectedValue(new Error('kapot'));
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('x'));

    const adapter = new PwaUpdateAdapter(
      '/sw.js',
      () => undefined,
      '/sw-classic.js',
      () => false,
      fetchFn,
    );
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('error'));

    expect(adapter.getState().errorDetail).toMatchObject({
      phase: 'register',
      swUrl: '/sw-classic.js',
      swType: 'classic',
    });
  });

  it('kapt een lange foutmelding af op PWA_ERROR_TEXT_MAX tekens', async () => {
    const container = stubContainer();
    container.register.mockRejectedValue(new Error('x'.repeat(PWA_ERROR_TEXT_MAX * 3)));
    const adapter = new PwaUpdateAdapter(
      '/sw.js',
      () => undefined,
      '/sw-classic.js',
      () => true,
      vi.fn().mockRejectedValue(new TypeError('x')),
    );
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('error'));

    expect(adapter.getState().errorDetail?.errorMessage).toHaveLength(PWA_ERROR_TEXT_MAX);
    expect(truncateDiagnosticText('kort')).toBe('kort');
  });

  it('probe: legt status, type en content-type van het eigen sw-bestand vast, en leest nooit de body', async () => {
    const container = stubContainer();
    container.register.mockRejectedValue(new Error('boom'));
    const response = fakeResponse({
      status: 200,
      type: 'basic',
      contentType: 'text/html; charset=utf-8',
    });
    const fetchFn = vi.fn().mockResolvedValue(response);

    const adapter = new PwaUpdateAdapter(
      '/sw.js',
      () => undefined,
      '/sw-classic.js',
      () => true,
      fetchFn,
    );
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().errorDetail?.probe).toBeDefined());

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/sw.js', {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
    });
    expect(adapter.getState().errorDetail?.probe).toEqual({
      ok: true,
      status: 200,
      responseType: 'basic',
      contentType: 'text/html; charset=utf-8',
      redirected: false,
    });
    expect(adapter.getState().status).toBe('error');
  });

  it('probe: een redirect (opaqueredirect) wordt als zodanig vastgelegd', async () => {
    const container = stubContainer();
    container.register.mockRejectedValue(new Error('boom'));
    const fetchFn = vi
      .fn()
      .mockResolvedValue(fakeResponse({ status: 0, type: 'opaqueredirect', contentType: null }));

    const adapter = new PwaUpdateAdapter(
      '/sw.js',
      () => undefined,
      '/sw-classic.js',
      () => true,
      fetchFn,
    );
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().errorDetail?.probe).toBeDefined());

    expect(adapter.getState().errorDetail?.probe).toEqual({
      ok: true,
      status: 0,
      responseType: 'opaqueredirect',
      contentType: null,
      redirected: false,
    });
    const text = formatPwaErrorDetail(adapter.getState().errorDetail!);
    expect(text).toContain('probe: status 0, type opaqueredirect, content-type -, redirected no');
  });

  it('probe die zelf faalt: stil vastgelegd als mislukt, zonder throw en met behoud van de fout', async () => {
    const container = stubContainer();
    container.register.mockRejectedValue(new Error('boom'));
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const adapter = new PwaUpdateAdapter(
      '/sw.js',
      () => undefined,
      '/sw-classic.js',
      () => true,
      fetchFn,
    );
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().errorDetail?.probe).toBeDefined());

    expect(adapter.getState().errorDetail?.probe).toEqual({ ok: false, errorName: 'TypeError' });
    expect(adapter.getState().status).toBe('error');
    expect(adapter.getState().errorDetail?.errorMessage).toBe('boom');
  });

  it('een late probe-uitkomst overschrijft een inmiddels genegeerde fout niet', async () => {
    const container = stubContainer();
    container.register.mockRejectedValue(new Error('boom'));
    let resolveFetch: (r: Response) => void = () => undefined;
    const fetchFn = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const adapter = new PwaUpdateAdapter(
      '/sw.js',
      () => undefined,
      '/sw-classic.js',
      () => true,
      fetchFn,
    );
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('error'));

    adapter.dismissError();
    resolveFetch(fakeResponse({ status: 200, type: 'basic', contentType: 'text/javascript' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.getState().status).toBe('idle');
    expect(adapter.getState().errorDetail).toBeUndefined();
  });

  it('controllerchange-timeout: legt fase, script en een Timeout-melding vast, zonder probe', async () => {
    const container = stubContainer();
    const registration = new FakeRegistration();
    registration.waiting = new FakeServiceWorker();
    container.register.mockResolvedValue(registration);
    const fetchFn = vi.fn();

    const adapter = new PwaUpdateAdapter(
      '/sw.js',
      () => undefined,
      '/sw-classic.js',
      () => true,
      fetchFn,
    );
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('update-available'));

    vi.useFakeTimers();
    adapter.confirmUpdate();
    vi.advanceTimersByTime(CONTROLLERCHANGE_TIMEOUT_MS);

    const state = adapter.getState();
    expect(state.status).toBe('error');
    expect(state.registered).toBe(true);
    expect(state.errorDetail).toEqual({
      phase: 'controllerchange',
      swUrl: '/sw.js',
      swType: 'module',
      errorName: 'Timeout',
      errorMessage: `geen controllerchange binnen ${CONTROLLERCHANGE_TIMEOUT_MS} ms na SKIP_WAITING`,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('retry() en dismissError() wissen het detail; andere statussen hebben er geen', async () => {
    const container = stubContainer();
    container.register.mockRejectedValueOnce(new Error('boom'));
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('x'));
    const adapter = new PwaUpdateAdapter(
      '/sw.js',
      () => undefined,
      '/sw-classic.js',
      () => true,
      fetchFn,
    );
    adapter.init();
    await vi.waitFor(() => expect(adapter.getState().errorDetail).toBeDefined());

    container.register.mockResolvedValue(new FakeRegistration());
    adapter.retry();
    await vi.waitFor(() => expect(adapter.getState().registered).toBe(true));
    expect(adapter.getState().status).toBe('idle');
    expect(adapter.getState().errorDetail).toBeUndefined();
  });
});

describe('formatPwaErrorDetail', () => {
  it('geeft één regel per veld en laat ontbrekende velden weg', () => {
    expect(formatPwaErrorDetail({ phase: 'register', swUrl: '/sw.js', swType: 'module' })).toBe(
      'phase: register\nscript: /sw.js (module)',
    );
    expect(
      formatPwaErrorDetail({
        phase: 'register',
        swUrl: '/sw.js',
        swType: 'classic',
        errorName: 'TypeError',
        errorMessage: 'kapot',
        probe: { ok: false, errorName: 'TypeError' },
      }),
    ).toBe(
      'phase: register\nscript: /sw.js (classic)\nerror: TypeError: kapot\nprobe: failed (TypeError)',
    );
  });
});
