import type { GamePlayer } from '../../domain/game/types';

/**
 * Categorietag achter de klasse van een speler (bijv. "2.5 V"), R6 bouwplan
 * Rustig. Eén bron voor alle wedstrijdschermen (Klassiek, Compact, Snel en
 * hun dialogen), zodat de notatie niet per scherm uiteen kan lopen.
 *
 * Volgt de v1-referentie (`chipHtml()` in de root-`index.html`): de letter is
 * de eerste letter (hoofdletter) van het ingestelde label `tag1Label`
 * (categorie 1, bijv. "Vrouw" → V, "Female" → F) en `tag2Label` (categorie 2,
 * bijv. "Jeugd" → J). Zonder ingesteld label vult `App` de vertaalde
 * standaardlabels in (`toggleTag1Default`/`toggleTag2Default`), net als v1.
 * Beide categorieën: beide letters, categorie 1 eerst ("VJ").
 */
export function categoryLetter(label: string): string {
  return label.trim().charAt(0).toUpperCase();
}

export function playerTag(
  player: Pick<GamePlayer, 'vrouw' | 'jeugd'>,
  tag1Label: string,
  tag2Label: string,
): string {
  const tag1 = categoryLetter(tag1Label);
  const tag2 = categoryLetter(tag2Label);
  return player.vrouw ? (player.jeugd ? `${tag1}${tag2}` : tag1) : player.jeugd ? tag2 : '';
}
