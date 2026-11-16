// @vitest-environment jsdom
// R6 (docs/wedstrijdscherm-rustig-bouwplan.md): de categorietag achter de klasse
// ("2.5 V" / "2.5 F") komt overal uit één helper en volgt het ingestelde label
// (v1-referentie `chipHtml()`), zodat Klassiek, Compact en Snel dezelfde notatie
// tonen. Fictieve spelers.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { categoryLetter, playerTag } from '../../src/ui/game/playerTag';
import { LiveTrackingPanel } from '../../src/ui/game/LiveTrackingPanel';
import { CompactLivePanel } from '../../src/ui/game/CompactLivePanel';
import { QuickLivePanel } from '../../src/ui/game/QuickLivePanel';
import { commitSegment } from '../../src/domain/game/liveCommands';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import { translate } from '../../src/i18n/strings';

afterEach(() => cleanup());

describe('playerTag', () => {
  const none = { vrouw: false, jeugd: false };
  const cat1 = { vrouw: true, jeugd: false };
  const cat2 = { vrouw: false, jeugd: true };
  const both = { vrouw: true, jeugd: true };

  it('neemt de eerste letter van het label als hoofdletter', () => {
    expect(playerTag(cat1, 'Vrouw', 'Jeugd')).toBe('V');
    expect(playerTag(cat1, 'Female', 'Youth')).toBe('F');
    expect(playerTag(cat2, 'Vrouw', 'jeugd')).toBe('J');
    expect(playerTag(both, 'vrouw', 'jeugd')).toBe('VJ');
    expect(playerTag(none, 'Vrouw', 'Jeugd')).toBe('');
  });

  it('negeert spaties vooraan in het label', () => {
    expect(categoryLetter('  vrouw')).toBe('V');
    expect(categoryLetter('')).toBe('');
  });

  it('zonder ingesteld label: dezelfde vertaalde standaard als v1 (NL en EN)', () => {
    expect(
      playerTag(both, translate('nl', 'toggleTag1Default'), translate('nl', 'toggleTag2Default')),
    ).toBe('CC');
    expect(
      playerTag(both, translate('en', 'toggleTag1Default'), translate('en', 'toggleTag2Default')),
    ).toBe('CC');
  });
});

function player(n: number, extra: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id: `gp-${n}`,
    rosterId: n,
    nr: String(n),
    naam: `Speler ${n}`,
    kl: n === 1 ? '2.5' : '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: n <= 5,
    ...extra,
  };
}

const CLASSIFICATION = {
  useClassLimit: true,
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1,
  bonusBoth: 2,
};

/** Speler 1: klasse 2.5, categorie 1. Eén vastgelegd segment, zodat Snel het veld toont. */
function game(): ActiveGame {
  const base: ActiveGame = {
    id: 'game-tag',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: [player(1, { vrouw: true }), ...[2, 3, 4, 5, 6].map((n) => player(n))],
    opponent: 'Tegen',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
    curQuarter: 1,
    beginSec: 600,
    endSec: 600,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
  };
  const r = commitSegment(base, { endSec: 500, classification: CLASSIFICATION });
  if (!r.ok) throw new Error(r.error);
  return r.game;
}

const PANELS = [
  ['Klassiek', LiveTrackingPanel],
  ['Compact', CompactLivePanel],
  ['Snel', QuickLivePanel],
] as const;

describe('alle wedstrijdschermen tonen dezelfde notatie', () => {
  it.each(PANELS)('%s: "2.5 V" met label Vrouw, "2.5 F" met label Female', (_name, Panel) => {
    for (const [label, expected] of [
      ['Vrouw', '2.5 V'],
      ['Female', '2.5 F'],
    ] as const) {
      const view = render(
        <Panel
          lang="nl"
          game={game()}
          quarterCount={4}
          periodLabel="Kwart"
          classification={CLASSIFICATION}
          teamName="Team"
          tag1Label={label}
          tag2Label="Jeugd"
          onGameChange={vi.fn()}
          onFinishGame={vi.fn()}
          canWrite
          saveError={false}
        />,
      );
      const text = view.container.textContent ?? '';
      expect(text).toContain(expected);
      // Geen andere letter achter dezelfde klasse.
      const other = expected.endsWith('V') ? '2.5 F' : '2.5 V';
      expect(text).not.toContain(other);
      cleanup();
    }
  });
});
