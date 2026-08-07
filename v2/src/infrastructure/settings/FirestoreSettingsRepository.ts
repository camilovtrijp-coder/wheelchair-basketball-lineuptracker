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
// geëmitteerd (gate uit ADR-002 §"Syncstatuscontract": een ongecachte context
// toont offline expliciet dat internet nodig is, geen stille standaardwaarden).

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
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings/types';
import { deriveSyncState, type SyncState } from '../../domain/syncState';
import type { AsyncSettingsRepository } from '../../application/settings/AsyncSettingsRepository';

export class FirestoreSettingsRepository implements AsyncSettingsRepository {
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
      return stripUpdatedAt(snap.data());
    } catch {
      const snap = await getDoc(ref);
      if (!snap.exists()) return { ...DEFAULT_SETTINGS };
      return stripUpdatedAt(snap.data());
    }
  }

  async write(
    settings: Settings & Record<string, unknown>,
  ): Promise<{ ok: boolean; syncState: SyncState; error?: unknown }> {
    try {
      await setDoc(this.ref(), { ...settings, updatedAt: serverTimestamp() });
      return {
        ok: true,
        syncState: { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false },
      };
    } catch (error) {
      return {
        ok: false,
        syncState: { status: 'actie-nodig', fromCache: false, hasPendingWrites: false },
        error,
      };
    }
  }

  async reset(): Promise<Settings & Record<string, unknown>> {
    const defaults: Settings & Record<string, unknown> = { ...DEFAULT_SETTINGS };
    await this.write(defaults);
    return defaults;
  }

  subscribe(
    onNext: (settings: Settings & Record<string, unknown>, sync: SyncState) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    return onSnapshot(
      this.ref().withConverter(settingsConverter),
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.exists()) return;
        onNext(stripUpdatedAt(snap.data()), deriveSyncState(snap.metadata));
      },
      (err) => {
        if (onError) onError(err);
      },
    );
  }
}

function stripUpdatedAt(doc: { updatedAt: unknown }): Settings & Record<string, unknown> {
  const { updatedAt: _updatedAt, ...rest } = doc;
  void _updatedAt;
  return rest as Settings & Record<string, unknown>;
}
