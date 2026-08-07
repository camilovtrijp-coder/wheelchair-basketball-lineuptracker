// Async-wrapper rond de bestaande synchrone LocalStorageSettingsRepository
// (PR 5.3c-1). Laat App/de panels uitsluitend tegen AsyncSettingsRepository
// praten, ongeacht of de actieve modus lokaal of cloud is — zie
// docs/pr-5.3-plan.md §C/5.3c-1, architecturale keuze (optie A).
//
// Er is geen server om op te wachten, dus write()/reset() resolven synchroon
// in een Promise. 'lokaal-beschikbaar' (niet 'gesynchroniseerd') is de
// correcte ADR-002-status: er heeft geen serverbevestiging plaatsgevonden.
// Een falende write levert 'actie-nodig' op zodat de aanroeper (via `ok`)
// hetzelfde faalpad als de cloud-adapter kan volgen; de indicator zelf blijft
// in lokale modus verborgen (App/AuthGate tonen 'm alleen bij mode==='cloud').

import type { Settings } from '../../domain/settings/types';
import type { SyncState, WriteResult } from '../../domain/syncState';
import type { AsyncSettingsRepository } from '../../application/settings/AsyncSettingsRepository';
import type { SettingsRepository } from '../../application/settings/SettingsRepository';

const SYNCED: SyncState = {
  status: 'lokaal-beschikbaar',
  fromCache: false,
  hasPendingWrites: false,
};
const FAILED: SyncState = { status: 'actie-nodig', fromCache: false, hasPendingWrites: false };

export class LocalAsyncSettingsRepository implements AsyncSettingsRepository {
  constructor(private readonly sync: SettingsRepository) {}

  async read(): Promise<Settings & Record<string, unknown>> {
    return this.sync.read();
  }

  async write(settings: Settings & Record<string, unknown>): Promise<WriteResult> {
    const ok = this.sync.write(settings);
    return ok
      ? { ok: true, syncState: SYNCED, settled: Promise.resolve({ ok: true }) }
      : { ok: false, syncState: FAILED, settled: Promise.resolve({ ok: false }) };
  }

  async reset(): Promise<Settings & Record<string, unknown>> {
    return this.sync.reset();
  }

  subscribe(
    onNext: (settings: Settings & Record<string, unknown>, sync: SyncState) => void,
  ): () => void {
    onNext(this.sync.read(), SYNCED);
    return () => undefined;
  }
}
