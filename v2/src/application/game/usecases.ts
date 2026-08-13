import type { ActiveGame } from '../../domain/game/types';
import type { GameRepository } from './GameRepository';

export function getActiveGame(repo: GameRepository): ActiveGame | null {
  return repo.read();
}

export function saveActiveGame(repo: GameRepository, game: ActiveGame): boolean {
  return repo.write(game);
}
