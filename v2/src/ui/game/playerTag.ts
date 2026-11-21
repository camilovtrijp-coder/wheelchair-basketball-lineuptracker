import type { GamePlayer } from '../../domain/game/types';

/**
 * Eén bron voor het categorieletterlabel achter de klasse ("2.5 V", "3.0 VJ").
 * De letter is de eerste letter van het categorielabel uit de instellingen
 * (v1-gedrag); alle wedstrijdschermen gebruiken deze functie zodat dezelfde
 * speler overal dezelfde letters krijgt. Alleen weergave: de velden `vrouw` en
 * `jeugd` en het CSV-contract blijven ongewijzigd.
 */
export function playerTag(player: GamePlayer, tag1Label: string, tag2Label: string): string {
  const tag1 = tag1Label.charAt(0).toUpperCase();
  const tag2 = tag2Label.charAt(0).toUpperCase();
  return player.vrouw ? (player.jeugd ? `${tag1}${tag2}` : tag1) : player.jeugd ? tag2 : '';
}
