import type { ActiveGame, CompletedGame } from '../../domain/game/types';
import { deriveGameHistory } from '../../domain/game/tracking';
import type { AnalysisGame } from '../../domain/stats/types';
import type {
  CompletedGameRepository,
  CompletedGamesReadResult,
} from '../game/CompletedGameRepository';

/**
 * PR 6.4 §C.1 / §D.6.4b — application-laag die één `AnalysisGame[]` bouwt
 * uit (a) de afgeronde wedstrijden van `CompletedGameRepository` en (b)
 * de actuele `ActiveGame` als voorlopige, aanvullende invoer wanneer
 * `deriveGameHistory()` minstens één segment oplevert. De UI leest nooit
 * zelf `localStorage` of Firestore; deze functie is de canonieke brug.
 *
 * Provenance: de actieve wedstrijd krijgt een aparte, niet-botsende
 * `AnalysisGame.id` zodat hij nooit per ongeluk overlapt met een
 * afgeronde wedstrijd in dezelfde UI-keuzelijst (§C.3.8). Wij gebruiken
 * de canonieke `ActiveGame.id` als die nog niet voorkomt in de
 * afgeronde-historie; anders een synthetische `current:<id>`-prefix om
 * de uniekheid in het Stats-filter (`gameIds`) te garanderen.
 */

export interface AnalysisScope {
  games: AnalysisGame[];
  /**
   * Het resultaat van het inlezen van de afgeronde-historie. De UI
   * gebruikt dit om onderscheid te maken tussen "leeg" / "ontbrekend" /
   * "fout" — `[]` is geen bewijs voor "geen wedstrijden" (PR 6.4 §A.2).
   * De actieve wedstrijd heeft géén invloed op deze status; hij kan nog
   * segmenten hebben terwijl de historie een readfout vertoont.
   */
  historyRead: CompletedGamesReadResult;
}

export function buildAnalysisScope(
  repository: CompletedGameRepository,
  activeGame: ActiveGame | null,
): AnalysisScope {
  const historyRead = readHistory(repository);
  const completedIds = new Set(historyRead.games.map((g) => g.id));
  const archivedSourceIds = new Set(
    historyRead.games
      .map((g) => (g as CompletedGame & { sourceGameId?: string }).sourceGameId)
      .filter((x): x is string => typeof x === 'string'),
  );

  const fromHistory: AnalysisGame[] = historyRead.games.map(toAnalysisGame);

  let currentAnalysis: AnalysisGame | null = null;
  if (activeGame !== null) {
    const derived = deriveGameHistory(activeGame);
    if (derived.segments.length > 0 && !archivedSourceIds.has(activeGame.id)) {
      const desiredId = completedIds.has(activeGame.id)
        ? `current:${activeGame.id}`
        : activeGame.id;
      currentAnalysis = {
        id: desiredId,
        opponent: activeGame.opponent,
        competition: activeGame.competition,
        date: new Date().toISOString(),
        players: activeGame.players,
        segments: derived.segments,
        scoreFor: derived.scoreFor,
        scoreAgainst: derived.scoreAgainst,
        isCurrent: true,
      };
    }
  }

  return {
    games: currentAnalysis ? [currentAnalysis, ...fromHistory] : fromHistory,
    historyRead,
  };
}

function readHistory(repository: CompletedGameRepository): CompletedGamesReadResult {
  // safeList is de voorkeur; val terug op list() + 'ok' voor adapters die
  // het onderscheid niet kennen (zie interface `CompletedGameRepository`).
  if (typeof repository.safeList === 'function') {
    return repository.safeList();
  }
  return { status: 'ok', games: repository.list() };
}

function toAnalysisGame(game: CompletedGame): AnalysisGame {
  return {
    id: game.id,
    opponent: game.opponent,
    competition: game.competition,
    date: game.date,
    players: game.players,
    segments: game.segments,
    scoreFor: game.scoreFor,
    scoreAgainst: game.scoreAgainst,
    isCurrent: false,
  };
}
