import {
  doc,
  getDoc,
  getDocFromCache,
  setDoc,
  onSnapshot,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { DEFAULT_SETTINGS } from '../../../v2/src/domain/settings/types.js';
import type { Settings } from '../../../v2/src/domain/settings/types.js';
import type { AsyncSettingsRepository } from '../ports/AsyncSettingsRepository.js';
import { deriveSyncState, type SyncState } from '../domain/syncState.js';

export class FirestoreSettingsRepository implements AsyncSettingsRepository {
  constructor(
    private db: Firestore,
    private orgId: string,
    private teamId: string,
  ) {}

  private ref() {
    return doc(
      this.db,
      'organizations',
      this.orgId,
      'teams',
      this.teamId,
      'settings',
      'current',
    );
  }

  async read(): Promise<Settings & Record<string, unknown>> {
    // Probeer de lokale cache eerst zodat read() ook offline werkt (pending writes zijn zichtbaar).
    // Val terug op getDoc() (server) als het document nog nooit is opgehaald.
    try {
      const snap = await getDocFromCache(this.ref());
      return snap.exists()
        ? (snap.data() as Settings & Record<string, unknown>)
        : { ...DEFAULT_SETTINGS };
    } catch {
      const snap = await getDoc(this.ref());
      return snap.exists()
        ? (snap.data() as Settings & Record<string, unknown>)
        : { ...DEFAULT_SETTINGS };
    }
  }

  async write(
    settings: Settings & Record<string, unknown>,
  ): Promise<{ ok: boolean; syncState: SyncState }> {
    try {
      // setDoc's Promise blijft pending terwijl offline (lokale schrijf is geaccepteerd)
      // en resolvet na serverbevestiging, of rejectet bij een Rules-afwijzing na reconnect.
      await setDoc(this.ref(), { ...settings, updatedAt: serverTimestamp() });
      return {
        ok: true,
        syncState: { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false },
      };
    } catch {
      // Geweigerde write = 'actie-nodig'. Aanroeper is verantwoordelijk voor lokale
      // recovery van de payload, conform ADR-002 "nooit stil dataverlies".
      return {
        ok: false,
        syncState: { status: 'actie-nodig', fromCache: false, hasPendingWrites: false },
      };
    }
  }

  async reset(): Promise<Settings & Record<string, unknown>> {
    await this.write({ ...DEFAULT_SETTINGS });
    return { ...DEFAULT_SETTINGS };
  }

  subscribe(
    onNext: (settings: Settings & Record<string, unknown>, sync: SyncState) => void,
  ): () => void {
    return onSnapshot(
      this.ref(),
      { includeMetadataChanges: true },
      (snap) => {
        const data = snap.exists()
          ? (snap.data() as Settings & Record<string, unknown>)
          : { ...DEFAULT_SETTINGS };
        onNext(data, deriveSyncState(snap.metadata));
      },
      (err) => console.error('[FirestoreSettings] onSnapshot error:', err.code, err.message),
    );
  }
}
