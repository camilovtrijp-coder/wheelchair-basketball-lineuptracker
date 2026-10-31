// PR 7.6a, plan §B: de aanname dat een afronding die nog niet server-bevestigd
// is de outbox-snapshot van het moment van afronden uploadt, en dat een latere
// lokale correctie daar NIET in terechtkomt. Dit is de reden dat corrigeren is
// uitgezet tot de afronding gesynchroniseerd is (plan §D.5).
import { describe, it, expect } from 'vitest';
import { LocalStoragePendingFinalizeRepository } from '../../src/infrastructure/game/LocalStoragePendingFinalizeRepository';
import { LocalStorageCompletedGameRepository } from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';
import { correctSegment } from '../../src/domain/game/correction';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import type { ActiveGame, CompletedGame } from '../../src/domain/game/types';

class MemoryStorage implements KeyValueStorage {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const completed: CompletedGame = {
  id: 'cg-1',
  organizationId: 'org-1',
  teamId: 'team-1',
  sourceGameId: 'src-1',
  opponent: 'Fictief Team',
  competition: '',
  date: '2026-01-01T10:00:00.000Z',
  players: [],
  segments: [
    {
      id: 's1',
      quarter: 1,
      beginSec: 600,
      endSec: 420,
      durSec: 180,
      lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
      pf: 6,
      pa: 4,
      classSum: 15,
      allowed: 14.5,
      over: false,
      tov: 2,
    },
  ],
  scoreFor: 6,
  scoreAgainst: 4,
  quarterCount: 4,
  periodLabel: '',
  useClassLimit: false,
  revision: 0,
  deletedAt: null,
  deletedBy: null,
};

const activeGame = {
  id: 'src-1',
  organizationId: 'org-1',
  teamId: 'team-1',
  phase: 'tracking',
  players: [],
  opponent: 'Fictief Team',
  competition: '',
  clockDown: true,
  limitStr: '14.5',
  onCourt: [],
  curQuarter: 1,
  beginSec: 0,
  endSec: 0,
  pendingSwapLineup: null,
  actions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  startedAt: '2026-01-01T00:05:00.000Z',
} as unknown as ActiveGame;

describe('PR 7.6a — outbox-snapshot en latere correctie (plan §B)', () => {
  it('een lokale correctie na afronden wijzigt de outbox-entry niet', () => {
    const storage = new MemoryStorage();
    const outbox = new LocalStoragePendingFinalizeRepository(storage, 'org-1', 'team-1');
    const completedRepo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(completedRepo.add(completed)).toBe(true);
    expect(outbox.add({ game: activeGame, completed })).toBe(true);

    const corrected = correctSegment(completed, 's1', { pf: 9 }, 'uid-alice');
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    expect(completedRepo.update(corrected.game)).toBe(true);

    // De lokale kopie bevat de correctie ...
    const local = completedRepo.list()[0] as CompletedGame;
    expect(local.corrections).toHaveLength(1);
    expect(local.scoreFor).toBe(9);
    // ... de outbox-snapshot (wat finalize() uploadt) niet.
    const queued = outbox.list()[0]?.completed as CompletedGame;
    expect(queued.corrections ?? []).toHaveLength(0);
    expect(queued.scoreFor).toBe(6);
    expect(queued.revision).toBe(0);
  });
});
