export const ROSTER_STORAGE_KEY = 'lineup-tracker-roster';

export interface Player {
  id: number;
  nr: string;
  naam: string;
  kl: string;
  vrouw: boolean;
  jeugd: boolean;
}

export const PLAYER_KEYS = [
  'id',
  'nr',
  'naam',
  'kl',
  'vrouw',
  'jeugd',
] as const satisfies ReadonlyArray<keyof Player>;

/** Een speler zoals gelezen uit opslag: bekende velden plus eventueel onbekende v1-velden. */
export type RosterPlayer = Player & Record<string, unknown>;
export type Roster = RosterPlayer[];

export const DEFAULT_KL = '3.0';
