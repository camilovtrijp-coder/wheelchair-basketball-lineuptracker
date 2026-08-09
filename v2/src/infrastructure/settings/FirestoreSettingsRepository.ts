// Firestore-implementatie van AsyncSettingsRepository.
//
// Bewaart het pad organizations/{orgId}/teams/{teamId}/settings/current (spiegelt
// firebase/firestore.rules §settings — toegestaan via canReadTeam / canManageTeamData)
// en gebruikt settingsConverter uit firebase-base/documents voor typed read/write.
//
// read() probeert eerst de lokale cache (getDocFromCache) zodat een gecachte
// context ook offline leesbaar blijft; valt terug op getDoc() wanneer het document
// nooit eerder is opgehaald. subscribe() gebruikt onSnapshot met
// includeMetadataChanges zodat de UI de overgang wacht-op-synchronisatie →
// gesynchroniseerd direct kan tonen. Een leeg document wordt NOOIT als defaults
// geëmitteerd (gate uit ADR-002 §"Syncstatuscontract": een ongecachete context
// toont offline expliciet dat internet nodig is, geen stille standaardwaarden).
//
// LET OP (PR 5.3d-vervolgonderzoek, aug. 2026): read()/getDocFromCache() en de
// onSnapshot-listener hierboven blijven voor DIT document onbepaald hangen
// zodra er een offline, nog niet aan de server bevestigde write op datzelfde
// document in de mutatiequeue staat — geverifieerd met directe instrumentatie
// (zie PR #36-onderzoekslog): een write() hier tijdens context.setOffline()
// laat zowel latere getDocFromCache()-aanroepen als de onSnapshot-listener op
// PRECIES dit document nooit meer reageren (getest tot 25s), terwijl een
// read() op een ANDER document (roster) op hetzelfde Firestore-client-object
// tegelijk gewoon normaal resolvet. Reproduceerbaar via zowel
// context.setOffline() als een expliciete route.abort() op de emulatorpoort,
// en onafhankelijk van persistentLocalCache vs. memoryLocalCache en van
// experimentalForceLongPolling vs. auto-detect — dus geen Playwright/CDP-
// artefact en geen Web-Locks/persistentie-kwestie. Dit is de kern van waarom
// issue #27 een harde OPEN gate blijft; zie het PR 5.3d-onderzoeksrapport
// voor de volledige triangulatie en de nog openstaande vraag of dit ook op
// een echt apparaat/tegen productie-Firestore optreedt.
import {
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { settingsConverter } from 'firebase-base/documents';
import { DEFAULT_SETTINGS, type Settings, type SettingsKey } from '../../domain/settings/types';
import { deriveSyncState, type SyncState, type WriteResult } from '../../domain/syncState';
import type { AsyncSettingsRepository } from '../../application/settings/AsyncSettingsRepository';

export class FirestoreSettingsRepository implements AsyncSettingsRepository {
  private documentExists = false;

  constructor(
    private readonly db: Firestore,
    private readonly orgId: string,
    private readonly teamId: string,
  ) {}

  private ref() {
    return doc(this.db, 'organizations', this.orgId, 'teams', this.teamId, 'settings', 'current');
  }

  async read(): Promise<Settings & Record<string, unknown>> {
    const ref = this.ref().withConverter(settingsConverter);
    try {
      const snap = await getDocFromCache(ref);
      if (!snap.exists()) return { ...DEFAULT_SETTINGS };
      this.documentExists = true;
      return stripUpdatedAt(snap.data());
    } catch {
      const snap = await getDoc(ref);
      if (!snap.exists()) return { ...DEFAULT_SETTINGS };
      this.documentExists = true;
      return stripUpdatedAt(snap.data());
    }
  }

  // Wacht bewust NIET op setDoc()'s eigen Promise: die resolvet pas na
  // serverbevestiging en blijft offline onbeperkt pending, terwijl de write
  // lokaal al via latency compensation is toegepast. write() retourneert
  // daarom meteen het lokale resultaat; `settled` draagt de uiteindelijke
  // serverbevestiging/-afwijzing en reject nooit (zie domain/syncState.ts).
  async write(
    settings: Settings & Record<string, unknown>,
    changedKeys?: readonly SettingsKey[],
  ): Promise<WriteResult> {
    if (this.documentExists && changedKeys?.length === 0) {
      return {
        ok: true,
        syncState: {
          status: 'gesynchroniseerd',
          fromCache: false,
          hasPendingWrites: false,
        },
        settled: Promise.resolve({ ok: true }),
      };
    }
    const shouldPatch = this.documentExists && changedKeys !== undefined && changedKeys.length > 0;
    const payload = shouldPatch
      ? Object.fromEntries(changedKeys.map((key) => [key, settings[key]]))
      : settings;
    const serverAck = shouldPatch
      ? setDoc(this.ref(), { ...payload, updatedAt: serverTimestamp() }, { merge: true })
      : setDoc(this.ref(), { ...payload, updatedAt: serverTimestamp() });
    this.documentExists = true;
    const settled = serverAck.then(
      () => ({ ok: true }),
      (error: unknown) => {
        // Een afgewezen create kan lokaal al een bestaand snapshot hebben
        // opgeleverd. Forceer de volgende poging daarom terug naar een
        // volledige schemawrite in plaats van een mogelijk ongeldige patch.
        this.documentExists = false;
        return { ok: false, error };
      },
    );
    // `ok` is hier altijd true: setDoc() past de write via latency
    // compensation synchroon lokaal toe, en een eventuele afwijzing komt pas
    // later, via `settled` — er is geen synchroon-lokaal faalpad zoals bij
    // LocalAsyncSettingsRepository.write() (die daar wél `ok:false` kan
    // teruggeven, bijv. bij een lokale opslagfout).
    return {
      ok: true,
      syncState: { status: 'wacht-op-synchronisatie', fromCache: true, hasPendingWrites: true },
      settled,
    };
  }

  async reset(): Promise<Settings & Record<string, unknown>> {
    const defaults: Settings & Record<string, unknown> = { ...DEFAULT_SETTINGS };
    await this.write(defaults);
    return defaults;
  }

  subscribe(
    onNext: (
      settings: Settings & Record<string, unknown>,
      sync: SyncState,
      updatedAt?: number,
    ) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    return onSnapshot(
      this.ref().withConverter(settingsConverter),
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.exists()) {
          this.documentExists = false;
          return;
        }
        this.documentExists = true;
        const data = snap.data();
        onNext(stripUpdatedAt(data), deriveSyncState(snap.metadata), toEpochMillis(data.updatedAt));
      },
      (err) => {
        if (onError) onError(err);
      },
    );
  }
}

function toEpochMillis(value: unknown): number | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    'toMillis' in value &&
    typeof value.toMillis === 'function'
  ) {
    return value.toMillis();
  }
  return undefined;
}

function stripUpdatedAt(doc: { updatedAt: unknown }): Settings & Record<string, unknown> {
  const { updatedAt: _updatedAt, ...rest } = doc;
  void _updatedAt;
  return rest as Settings & Record<string, unknown>;
}
