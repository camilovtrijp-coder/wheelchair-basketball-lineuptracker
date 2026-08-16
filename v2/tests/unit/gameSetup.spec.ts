import { describe, it, expect } from 'vitest';
import type { Roster } from '../../src/domain/roster/types';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import {
  canStart,
  createGameFromRoster,
  duplicateStartNumbers,
  participatingPlayers,
  setClockDown,
  setCompetition,
  setLimitStr,
  setOpponent,
  startBlockReason,
  startCount,
  startGame,
  syncGamePlayersWithRoster,
  toggleParticipate,
  toggleStart,
  validPlayers,
} from '../../src/domain/game/setup';

function rosterPlayer(overrides: Partial<Roster[number]> = {}): Roster[number] {
  return {
    id: 1,
    nr: '7',
    naam: 'Jan',
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    ...overrides,
  };
}

function fiveNamedPlayerRoster(): Roster {
  return [1, 2, 3, 4, 5].map((n) => rosterPlayer({ id: n, nr: String(n), naam: `Speler ${n}` }));
}

function gamePlayer(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id: `gp-${overrides.rosterId ?? 1}`,
    rosterId: 1,
    nr: '7',
    naam: 'Jan',
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: false,
    ...overrides,
  };
}

function game(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'setup',
    players: [],
    opponent: '',
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
    startedAt: null,
    ...overrides,
  };
}

describe('domain/game/setup', () => {
  describe('createGameFromRoster', () => {
    it('snapshot elke rosterspeler met een eigen stabiele game-player-UUID, participate=true, start=false', () => {
      const roster = fiveNamedPlayerRoster();
      const g = createGameFromRoster(roster, 'org-1', 'team-1', 14.5);

      expect(g.organizationId).toBe('org-1');
      expect(g.teamId).toBe('team-1');
      expect(g.phase).toBe('setup');
      expect(g.players).toHaveLength(5);
      for (const p of g.players) {
        expect(p.participate).toBe(true);
        expect(p.start).toBe(false);
        expect(typeof p.id).toBe('string');
        expect(p.id).not.toBe(String(p.rosterId));
      }
      // Elke game-player-UUID is uniek.
      expect(new Set(g.players.map((p) => p.id)).size).toBe(5);
      expect(g.limitStr).toBe('14.5');
      expect(g.clockDown).toBe(true);
      expect(g.onCourt).toEqual([]);
    });

    it('sorteert de snapshot op rugnummer, ongeacht de opslagvolgorde van de roster', () => {
      const roster = [
        rosterPlayer({ id: 1, nr: '9', naam: 'Negen' }),
        rosterPlayer({ id: 2, nr: '3', naam: 'Drie' }),
      ];
      const g = createGameFromRoster(roster, 'org-1', 'team-1', 14.5);
      expect(g.players.map((p) => p.nr)).toEqual(['3', '9']);
    });

    it('twee opeenvolgende aanroepen leveren verschillende wedstrijd-UUIDs op', () => {
      const roster = fiveNamedPlayerRoster();
      const a = createGameFromRoster(roster, 'org-1', 'team-1', 14.5);
      const b = createGameFromRoster(roster, 'org-1', 'team-1', 14.5);
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('syncGamePlayersWithRoster (PR 5.5c-bugfixes bug 1)', () => {
    it('neemt een naam/rugnummer-wijziging over, met behoud van al gekozen participate/start', () => {
      const roster = fiveNamedPlayerRoster();
      const game = createGameFromRoster(roster, 'org-1', 'team-1', 14.5);
      const started = toggleStart(game, game.players[0]!.id);
      expect(started.players[0]!.participate).toBe(true);
      expect(started.players[0]!.start).toBe(true);

      const changedRoster = roster.map((p) =>
        p.id === 1 ? { ...p, naam: 'Jan Hernoemd', nr: '99' } : p,
      );
      const synced = syncGamePlayersWithRoster(started, changedRoster);

      expect(synced).not.toBe(started);
      const syncedPlayer = synced.players.find((p) => p.rosterId === 1)!;
      expect(syncedPlayer.naam).toBe('Jan Hernoemd');
      expect(syncedPlayer.nr).toBe('99');
      // Per-wedstrijd keuzes blijven behouden, dezelfde game-player-id ook.
      expect(syncedPlayer.participate).toBe(true);
      expect(syncedPlayer.start).toBe(true);
      expect(syncedPlayer.id).toBe(started.players[0]!.id);
    });

    it('voegt een nieuwe rosterspeler toe met de standaardkeuzes', () => {
      const roster = fiveNamedPlayerRoster();
      const game = createGameFromRoster(roster, 'org-1', 'team-1', 14.5);
      const withNewPlayer = [...roster, rosterPlayer({ id: 6, nr: '6', naam: 'Zes' })];

      const synced = syncGamePlayersWithRoster(game, withNewPlayer);

      expect(synced.players).toHaveLength(6);
      const newPlayer = synced.players.find((p) => p.rosterId === 6)!;
      expect(newPlayer.naam).toBe('Zes');
      expect(newPlayer.participate).toBe(true);
      expect(newPlayer.start).toBe(false);
    });

    it('laat een verwijderde rosterspeler uit de opzet vallen', () => {
      const roster = fiveNamedPlayerRoster();
      const game = createGameFromRoster(roster, 'org-1', 'team-1', 14.5);
      const withoutFirst = roster.filter((p) => p.id !== 1);

      const synced = syncGamePlayersWithRoster(game, withoutFirst);

      expect(synced.players).toHaveLength(4);
      expect(synced.players.some((p) => p.rosterId === 1)).toBe(false);
    });

    it('retourneert dezelfde referentie als er niets wijzigt (geen onnodige write/re-render)', () => {
      const roster = fiveNamedPlayerRoster();
      const game = createGameFromRoster(roster, 'org-1', 'team-1', 14.5);
      const synced = syncGamePlayersWithRoster(game, roster);
      expect(synced).toBe(game);
    });
  });

  describe('validPlayers / participatingPlayers / startCount', () => {
    it('telt alleen spelers met een ingevulde naam als geldig', () => {
      const g = game({
        players: [gamePlayer({ id: 'a', naam: 'Jan' }), gamePlayer({ id: 'b', naam: '  ' })],
      });
      expect(validPlayers(g)).toHaveLength(1);
    });

    it('participatingPlayers sluit non-participating spelers uit, ook als naam gevuld is', () => {
      const g = game({
        players: [
          gamePlayer({ id: 'a', naam: 'Jan', participate: true }),
          gamePlayer({ id: 'b', naam: 'Piet', participate: false }),
        ],
      });
      expect(participatingPlayers(g).map((p) => p.id)).toEqual(['a']);
    });

    it('startCount telt alleen starters die ook meedoen en een naam hebben', () => {
      const g = game({
        players: [
          gamePlayer({ id: 'a', naam: 'Jan', participate: true, start: true }),
          gamePlayer({ id: 'b', naam: 'Piet', participate: false, start: true }),
          gamePlayer({ id: 'c', naam: '', participate: true, start: true }),
        ],
      });
      expect(startCount(g)).toBe(1);
    });
  });

  describe('duplicateStartNumbers', () => {
    it('vindt rugnummers die meer dan eens voorkomen bij geldige spelers', () => {
      const g = game({
        players: [
          gamePlayer({ id: 'a', nr: '7', naam: 'Jan' }),
          gamePlayer({ id: 'b', nr: '7', naam: 'Piet' }),
          gamePlayer({ id: 'c', nr: '9', naam: 'Klaas' }),
        ],
      });
      expect(duplicateStartNumbers(g)).toEqual(['7']);
    });

    it('negeert spelers zonder naam bij het bepalen van duplicaten', () => {
      const g = game({
        players: [
          gamePlayer({ id: 'a', nr: '7', naam: 'Jan' }),
          gamePlayer({ id: 'b', nr: '7', naam: '' }),
        ],
      });
      expect(duplicateStartNumbers(g)).toEqual([]);
    });
  });

  describe('startBlockReason / canStart (v1-pariteit canStart())', () => {
    function fiveValidParticipating(): GamePlayer[] {
      return [1, 2, 3, 4, 5].map((n) =>
        gamePlayer({ id: `p${n}`, rosterId: n, nr: String(n), naam: `Speler ${n}` }),
      );
    }

    it('blokkeert bij minder dan 5 geldige spelers', () => {
      const g = game({ players: fiveValidParticipating().slice(0, 4) });
      expect(startBlockReason(g)).toBe('needFivePlayers');
      expect(canStart(g)).toBe(false);
    });

    it('blokkeert bij dubbele rugnummers', () => {
      const players = fiveValidParticipating();
      players[1] = { ...players[1]!, nr: players[0]!.nr };
      const g = game({ players });
      expect(startBlockReason(g)).toBe('duplicateNumbers');
    });

    it('blokkeert bij minder dan 5 deelnemende spelers', () => {
      const players = fiveValidParticipating().map((p, i) =>
        i === 0 ? { ...p, participate: false } : p,
      );
      const g = game({ players });
      expect(startBlockReason(g)).toBe('needFiveParticipants');
    });

    it('blokkeert bij 1-4 gekozen starters (moet 0 of 5 zijn)', () => {
      const players = fiveValidParticipating().map((p, i) => (i < 2 ? { ...p, start: true } : p));
      const g = game({ players });
      expect(startBlockReason(g)).toBe('chooseFiveStarters');
    });

    it('staat starten toe bij 0 gekozen starters (automatische keuze volgt)', () => {
      const g = game({ players: fiveValidParticipating() });
      expect(canStart(g)).toBe(true);
    });

    it('staat starten toe bij precies 5 gekozen starters', () => {
      const players = fiveValidParticipating().map((p) => ({ ...p, start: true }));
      const g = game({ players });
      expect(canStart(g)).toBe(true);
    });
  });

  describe('startGame (v1-pariteit startGame())', () => {
    function sixParticipating(): GamePlayer[] {
      return [1, 2, 3, 4, 5, 6].map((n) =>
        gamePlayer({ id: `p${n}`, rosterId: n, nr: String(n), naam: `Speler ${n}` }),
      );
    }

    it('retourneert null als nog niet gestart kan worden', () => {
      const g = game({ players: sixParticipating().slice(0, 3) });
      expect(startGame(g)).toBeNull();
    });

    it('plaatst exact de 5 gekozen starters op het veld', () => {
      const players = sixParticipating().map((p, i) => (i < 5 ? { ...p, start: true } : p));
      const g = game({ players });
      const started = startGame(g);
      expect(started).not.toBeNull();
      expect(started?.phase).toBe('tracking');
      expect(started?.onCourt.sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'].sort());
      expect(started?.startedAt).not.toBeNull();
    });

    it('kiest automatisch de 5 laagste rugnummers als er geen starters gekozen zijn', () => {
      const players = sixParticipating();
      // Bewust in willekeurige volgorde en met hoge/lage nummers door elkaar.
      const shuffled = [
        players[5]!,
        players[0]!,
        players[4]!,
        players[1]!,
        players[3]!,
        players[2]!,
      ];
      const g = game({ players: shuffled });
      const started = startGame(g);
      expect(started).not.toBeNull();
      const chosenNrs = started!.onCourt
        .map((id) => players.find((p) => p.id === id)?.nr)
        .sort((a, b) => Number(a) - Number(b));
      expect(chosenNrs).toEqual(['1', '2', '3', '4', '5']);
    });
  });

  describe('field setters', () => {
    it('toggleParticipate zet start ook uit wanneer participate uitgaat', () => {
      const g = game({
        players: [gamePlayer({ id: 'a', participate: true, start: true })],
      });
      const next = toggleParticipate(g, 'a');
      expect(next.players[0]!.participate).toBe(false);
      expect(next.players[0]!.start).toBe(false);
    });

    it('toggleParticipate laat start ongemoeid wanneer participate weer aangaat', () => {
      const g = game({
        players: [gamePlayer({ id: 'a', participate: false, start: false })],
      });
      const next = toggleParticipate(g, 'a');
      expect(next.players[0]!.participate).toBe(true);
      expect(next.players[0]!.start).toBe(false);
    });

    it('toggleStart wijzigt alleen de aangewezen speler', () => {
      const g = game({
        players: [gamePlayer({ id: 'a', start: false }), gamePlayer({ id: 'b', start: false })],
      });
      const next = toggleStart(g, 'a');
      expect(next.players[0]!.start).toBe(true);
      expect(next.players[1]!.start).toBe(false);
    });

    it('setOpponent/setCompetition/setClockDown/setLimitStr muteren het origineel niet', () => {
      const g = game();
      const a = setOpponent(g, 'Team B');
      const b = setCompetition(a, 'Competitie X');
      const c = setClockDown(b, false);
      const d = setLimitStr(c, '16.0');

      expect(g.opponent).toBe('');
      expect(d.opponent).toBe('Team B');
      expect(d.competition).toBe('Competitie X');
      expect(d.clockDown).toBe(false);
      expect(d.limitStr).toBe('16.0');
    });
  });
});
