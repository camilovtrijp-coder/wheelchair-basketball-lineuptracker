import { sortRoster } from '../roster/normalize';
import type { Roster } from '../roster/types';
import type { ActiveGame, GamePlayer } from './types';

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Bouwt een nieuwe wedstrijdopzet vanaf de huidige roster — spiegelt v1's
 * `freshState()`/`loadRoster()`: iedereen doet standaard weer mee, starters
 * kies je opnieuw (v1-comment: "'start' en 'participate' zijn per-wedstrijd
 * keuzes, geen teamgegevens"). Elke speler krijgt een eigen, stabiele
 * game-player-UUID (`id`) los van het roster-ID (`rosterId`) — zie
 * domain/game/types.ts.
 */
export function createGameFromRoster(
  roster: Roster,
  organizationId: string,
  teamId: string,
  classBaseLimit: number,
): ActiveGame {
  const now = new Date().toISOString();
  return {
    id: newId(),
    organizationId,
    teamId,
    phase: 'setup',
    players: sortRoster(roster).map((p) => ({
      id: newId(),
      rosterId: p.id,
      nr: p.nr,
      naam: p.naam,
      kl: p.kl,
      vrouw: p.vrouw,
      jeugd: p.jeugd,
      participate: true,
      start: false,
    })),
    opponent: '',
    competition: '',
    clockDown: true,
    limitStr: String(classBaseLimit),
    onCourt: [],
    createdAt: now,
    startedAt: null,
  };
}

/** Spelers met een ingevulde naam (v1: `validPlayers`). */
export function validPlayers(game: ActiveGame): GamePlayer[] {
  return game.players.filter((p) => p.naam.trim() !== '');
}

/**
 * Spelers die voor déze wedstrijd meedoen (v1: `participatingPlayers`). De
 * "Meedoen"-toggle op het Team-tabblad blijft de speler wel gewoon in de
 * teamlijst, maar telt hier niet mee.
 */
export function participatingPlayers(game: ActiveGame): GamePlayer[] {
  return validPlayers(game).filter((p) => p.participate);
}

/** Aantal gekozen starters (v1: `startCount`). */
export function startCount(game: ActiveGame): number {
  return game.players.filter((p) => p.start && p.naam.trim() !== '' && p.participate).length;
}

/** Rugnummers die meer dan eens voorkomen bij spelers met een naam (v1: `dupNrs`). */
export function duplicateStartNumbers(game: ActiveGame): string[] {
  const counts = new Map<string, number>();
  for (const p of validPlayers(game)) {
    const nr = p.nr.trim();
    if (nr === '') continue;
    counts.set(nr, (counts.get(nr) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([nr]) => nr);
}

export type StartBlockReason =
  'needFivePlayers' | 'duplicateNumbers' | 'needFiveParticipants' | 'chooseFiveStarters';

/**
 * Eerste reden waarom de wedstrijd nog niet gestart kan worden, of `null` als
 * starten mag. Spiegelt v1's `canStart()`-voorwaarden, maar als volgorde van
 * losse redenen i.p.v. één boolean — nodig voor de per-reden foutmelding die
 * v1 al toont (zie index.html rond `startNeedFive`/`startFixDup`/...).
 */
export function startBlockReason(game: ActiveGame): StartBlockReason | null {
  if (validPlayers(game).length < 5) return 'needFivePlayers';
  if (duplicateStartNumbers(game).length > 0) return 'duplicateNumbers';
  if (participatingPlayers(game).length < 5) return 'needFiveParticipants';
  const sc = startCount(game);
  if (sc !== 0 && sc !== 5) return 'chooseFiveStarters';
  return null;
}

export function canStart(game: ActiveGame): boolean {
  return startBlockReason(game) === null;
}

export function toggleParticipate(game: ActiveGame, playerId: string): ActiveGame {
  return {
    ...game,
    players: game.players.map((p) => {
      if (p.id !== playerId) return p;
      const participating = !p.participate;
      // v1: het uitzetten van "Meedoen" zet ook "Start" uit.
      return { ...p, participate: participating, start: participating ? p.start : false };
    }),
  };
}

export function toggleStart(game: ActiveGame, playerId: string): ActiveGame {
  return {
    ...game,
    players: game.players.map((p) => (p.id === playerId ? { ...p, start: !p.start } : p)),
  };
}

export function setOpponent(game: ActiveGame, opponent: string): ActiveGame {
  return { ...game, opponent };
}

export function setCompetition(game: ActiveGame, competition: string): ActiveGame {
  return { ...game, competition };
}

export function setClockDown(game: ActiveGame, clockDown: boolean): ActiveGame {
  return { ...game, clockDown };
}

export function setLimitStr(game: ActiveGame, limitStr: string): ActiveGame {
  return { ...game, limitStr };
}

/**
 * Startvalidatie + fase-overgang (v1: `startGame()`). Retourneert `null`
 * wanneer nog niet gestart kan worden — zie `startBlockReason`. Bij precies 5
 * gekozen starters spelen exact die spelers; bij 0 gekozen starters worden
 * automatisch de 5 laagste rugnummers gekozen (identiek v1-gedrag, inclusief
 * de expliciete her-sortering — niet vertrouwen op toevallige arrayvolgorde).
 */
export function startGame(game: ActiveGame): ActiveGame | null {
  if (!canStart(game)) return null;

  const chosen = participatingPlayers(game).filter((p) => p.start);
  const onCourt =
    chosen.length === 5
      ? chosen.map((p) => p.id)
      : [...participatingPlayers(game)]
          .sort((a, b) => (parseInt(a.nr, 10) || 0) - (parseInt(b.nr, 10) || 0))
          .slice(0, 5)
          .map((p) => p.id);

  return {
    ...game,
    onCourt,
    phase: 'tracking',
    startedAt: new Date().toISOString(),
  };
}
