import { describe, expect, it } from 'vitest';
import { formatGameSyncWaitTimeoutMessage } from '../e2e-auth/gameSyncFixtures';

describe('formatGameSyncWaitTimeoutMessage', () => {
  it('bevat verwachte status, actuele status, timeout en online-status', () => {
    const message = formatGameSyncWaitTimeoutMessage({
      expectedStatus: 'gesynchroniseerd',
      actualStatus: 'wacht-op-synchronisatie',
      onLine: true,
      timeoutMs: 45_000,
    });
    expect(message).toContain('gesynchroniseerd');
    expect(message).toContain('wacht-op-synchronisatie');
    expect(message).toContain('45000ms');
    expect(message).toContain('navigator.onLine=true');
  });

  it('valt terug op een duidelijke placeholder als er geen indicator gevonden is', () => {
    const message = formatGameSyncWaitTimeoutMessage({
      expectedStatus: 'gesynchroniseerd',
      actualStatus: null,
      onLine: false,
      timeoutMs: 45_000,
    });
    expect(message).toContain('geen sync-status-indicator gevonden');
    expect(message).toContain('navigator.onLine=false');
  });

  it('accepteert uitsluitend statuscodes/timing/connectiviteit — geen veld voor speler-, team- of organisatiedata bestaat', () => {
    // Structurele garantie i.p.v. een tekstuele blocklist-check (die vals-
    // positief slaat op eigen technische tekst als "waitForGame..."): het
    // `formatGameSyncWaitTimeoutMessage`-signatuur heeft alleen `expectedStatus`/
    // `actualStatus`/`onLine`/`timeoutMs` — er is geen invoerveld waarlangs
    // speler-, team- of e-mailgegevens hier ooit in terecht zouden kunnen komen.
    const message = formatGameSyncWaitTimeoutMessage({
      expectedStatus: 'actie-nodig',
      actualStatus: 'gesynchroniseerd',
      onLine: true,
      timeoutMs: 20_000,
    });
    expect(message).toBe(
      'waitForGameSyncStatus: status bleef "gesynchroniseerd" i.p.v. de verwachte "actie-nodig" na 20000ms (navigator.onLine=true).',
    );
  });
});
