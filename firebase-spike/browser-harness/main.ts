// Browser-testharnas voor de Playwright-e2e-tests.
// Stelt window.harness bloot zodat Playwright via page.evaluate() de Firebase-adapters
// kan aansturen zonder een echte productie-UI. Geen Preact/React-component, puur TS.
//
// Wordt uitsluitend gebruikt vanuit tests/e2e/*.spec.ts — nooit als productie-code.

import {
  signInWithEmailAndPassword as signInModular,
  signOut as signOutModular,
} from 'firebase/auth';
import { initSpikeFirebase } from '../src/adapters/firebaseClient.js';
import { FirestoreSettingsRepository } from '../src/adapters/FirestoreSettingsRepository.js';
import { FirestoreRosterRepository } from '../src/adapters/FirestoreRosterRepository.js';
import type { SyncState } from '../src/domain/syncState.js';
import type { Settings } from '../../v2/src/domain/settings/types.js';
import type { Roster } from '../../v2/src/domain/roster/types.js';

const { db, auth } = initSpikeFirebase();

// In-memory recoverystore voor 'actie-nodig' writes (spiegelt ADR-002 "nooit stil verloren").
const pendingActionNodig: Array<{ type: string; payload: unknown; timestamp: number }> = [];

let lastSyncState: SyncState = { status: 'lokaal-beschikbaar', fromCache: true, hasPendingWrites: false };
let currentSettingsRepo: FirestoreSettingsRepository | null = null;
let currentRosterRepo: FirestoreRosterRepository | null = null;
let settingsUnsub: (() => void) | null = null;
let rosterUnsub: (() => void) | null = null;

const logEl = document.getElementById('log')!;
function log(msg: string) {
  logEl.textContent += '\n' + msg;
  console.log('[harnas]', msg);
}

// ---- Publieke API voor Playwright ----

interface Harness {
  signIn(email: string, password: string, orgId: string, teamId: string): Promise<void>;
  signOut(): Promise<void>;
  readSettings(): Promise<Settings & Record<string, unknown>>;
  writeSettings(patch: Partial<Settings>): Promise<{ ok: boolean; syncState: SyncState }>;
  readRoster(): Promise<Roster>;
  writeRoster(players: Roster): Promise<{ ok: boolean; syncState: SyncState }>;
  getLastSyncState(): SyncState;
  getPendingActionNodig(): Array<{ type: string; payload: unknown; timestamp: number }>;
  subscribeSettings(): void;
  subscribeRoster(): void;
}

const harness: Harness = {
  async signIn(email, password, orgId, teamId) {
    await signInModular(auth, email, password);
    currentSettingsRepo = new FirestoreSettingsRepository(db, orgId, teamId);
    currentRosterRepo   = new FirestoreRosterRepository(db, orgId, teamId);
    log(`Ingelogd als ${email} in org=${orgId} team=${teamId}`);
  },

  async signOut() {
    settingsUnsub?.();
    rosterUnsub?.();
    settingsUnsub = null;
    rosterUnsub   = null;
    currentSettingsRepo = null;
    currentRosterRepo   = null;
    await signOutModular(auth);
    log('Uitgelogd');
  },

  async readSettings() {
    if (!currentSettingsRepo) throw new Error('Niet ingelogd');
    return currentSettingsRepo.read();
  },

  async writeSettings(patch) {
    if (!currentSettingsRepo) throw new Error('Niet ingelogd');
    const current = await currentSettingsRepo.read();
    const merged  = { ...current, ...patch };
    const result  = await currentSettingsRepo.write(merged);
    lastSyncState = result.syncState;
    if (!result.ok) {
      pendingActionNodig.push({ type: 'settings', payload: merged, timestamp: Date.now() });
    }
    log(`writeSettings: ${JSON.stringify(result.syncState)}`);
    return result;
  },

  async readRoster() {
    if (!currentRosterRepo) throw new Error('Niet ingelogd');
    return currentRosterRepo.read();
  },

  async writeRoster(players) {
    if (!currentRosterRepo) throw new Error('Niet ingelogd');
    const result = await currentRosterRepo.write(players);
    lastSyncState = result.syncState;
    if (!result.ok) {
      pendingActionNodig.push({ type: 'roster', payload: players, timestamp: Date.now() });
    }
    log(`writeRoster: ${JSON.stringify(result.syncState)}`);
    return result;
  },

  getLastSyncState() {
    return lastSyncState;
  },

  getPendingActionNodig() {
    return pendingActionNodig;
  },

  subscribeSettings() {
    if (!currentSettingsRepo) throw new Error('Niet ingelogd');
    settingsUnsub?.();
    settingsUnsub = currentSettingsRepo.subscribe((_settings, sync) => {
      lastSyncState = sync;
      log(`onSnapshot settings: ${JSON.stringify(sync)}`);
    });
  },

  subscribeRoster() {
    if (!currentRosterRepo) throw new Error('Niet ingelogd');
    rosterUnsub?.();
    rosterUnsub = currentRosterRepo.subscribe((_players, sync) => {
      lastSyncState = sync;
      log(`onSnapshot roster: ${JSON.stringify(sync)}`);
    });
  },
};

// Maak de API globaal beschikbaar voor Playwright's page.evaluate().
(window as unknown as Record<string, unknown>)['harness'] = harness;

log('Testharnas gereed. window.harness beschikbaar.');
