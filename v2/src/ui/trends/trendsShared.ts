import type { AnalysisScope } from '../../application/stats/buildAnalysisScope';
import type { RosterPlayer } from '../../domain/roster/types';
import type { AnalysisGame } from '../../domain/stats/types';
import type { LineupInsights } from '../../domain/trends/lineupInsights';
import { translate, type Lang, type StringKey } from '../../i18n/strings';

/**
 * Gedeelde types en hulpfuncties van de Trends-weergaven (plan T2/T3).
 *
 * De schil (`TrendsPanel.tsx`) geeft ELKE weergave (`OverviewView`,
 * `LineupsView`, `PlayersView`, `QuartersView`) exact dezelfde `TrendsViewProps`.
 * Een weergave haalt hieruit wat hij nodig heeft en rekent zelf (gememoiseerd)
 * verder; weergaven importeren elkaar nooit. Zo kunnen vervolgstappen elk één
 * weergavebestand uitbreiden zonder de schil of de andere weergaven te raken.
 */

export type TrendsViewId = 'overview' | 'lineups' | 'players' | 'quarters';

export const TRENDS_VIEW_IDS: readonly TrendsViewId[] = [
  'overview',
  'lineups',
  'players',
  'quarters',
];

/** Gedeelde invoer van alle weergaven. Alles is alleen-lezen; wijzigingen lopen via de filterbalk. */
export interface TrendsViewProps {
  lang: Lang;
  /** Bron van de analyse: `games` (nieuwste eerst, actieve wedstrijd vooraan) en de leesstatus van de historie. */
  scope: AnalysisScope;
  /** Gemak: gelijk aan `scope.games` (ALLE wedstrijden, nog niet gefilterd op `gameIds`). */
  games: AnalysisGame[];
  /** Gedeeld wedstrijdfilter (zelfde state als Statistieken); `null` = alle wedstrijden. */
  gameIds: Set<string> | null;
  /** Chip "Per 10 min": `true` = waarden per 10 minuten, `false` = totalen. */
  per10: boolean;
  /** Drempel in seconden (filterbalk): 0 = uit, anders minimale totale speeltijd van een lineup. */
  minSec: number;
  /** Actuele roster (rugnummers/namen); historische spelers vallen terug op de snapshot. */
  roster: RosterPlayer[];
  /** Instelling "klassegrens" van de lopende wedstrijd (voor T6: classificatieprofiel). */
  useClassLimit: boolean;
  /**
   * Basis-lineupinzichten (vijftallen, gesorteerd op +/- per 10, drempel = `minSec`,
   * gekozen wedstrijden). Eén keer in de schil berekend en gedeeld door Overzicht
   * en Lineups. Heeft een weergave andere opties nodig (duo's, andere metriek),
   * dan roept hij `computeLineupInsights` zelf aan.
   */
  lineups: LineupInsights;
}

// ---- Drempel (chip "Drempel: 5:00") ----

/** Cyclus van de drempelchip in seconden: uit, 3:00, 5:00, 10:00. */
export const THRESHOLD_STEPS: readonly number[] = [0, 180, 300, 600];
/** Standaarddrempel (besluit eigenaar): 5:00 = 300 s. */
export const DEFAULT_MIN_SEC = 300;

export function nextThreshold(current: number): number {
  const i = THRESHOLD_STEPS.indexOf(current);
  return THRESHOLD_STEPS[(i + 1) % THRESHOLD_STEPS.length] ?? DEFAULT_MIN_SEC;
}

// ---- Toon (beter / rond gemiddelde / slechter) ----

export type Tone = 'good' | 'flat' | 'bad';

/** |verschil| onder deze waarde (per 10 min) geldt als "rond gemiddelde" (besluit eigenaar). */
export const FLAT_EPS_PER10 = 0.5;

/**
 * Toon van een verschil t.o.v. het teamgemiddelde. `higherIsBetter` is `true`
 * voor +/- en Voor, `false` voor Tegen en turnovers.
 */
export function toneOfDelta(
  delta: number,
  higherIsBetter: boolean,
  eps: number = FLAT_EPS_PER10,
): Tone {
  if (Math.abs(delta) < eps) return 'flat';
  return delta > 0 === higherIsBetter ? 'good' : 'bad';
}

/**
 * Toon van een +/--waarde per 10 min op het TEKEN (besluit eigenaar 2026-10-31):
 * groter dan `+eps` is groen, kleiner dan `-eps` is rood, en alles ertussen
 * (de grenzen zelf inbegrepen) is grijs. Het teamgemiddelde speelt GEEN rol;
 * dat blijft alleen als kleine tekst staan. Alleen voor +/-; Voor/Tegen en
 * turnovers blijven relatief aan het team (`toneOfDelta`).
 */
export function toneOfSign(valuePer10: number, eps: number = FLAT_EPS_PER10): Tone {
  if (valuePer10 > eps) return 'good';
  if (valuePer10 < -eps) return 'bad';
  return 'flat';
}

/** Symbool dat samen met tekst de toon draagt; kleur is nooit de enige aanwijzing. */
export function toneSymbol(tone: Tone): string {
  return tone === 'good' ? '▲' : tone === 'bad' ? '▼' : '●';
}

export function toneKey(tone: Tone): StringKey {
  return tone === 'good'
    ? 'trendsLineupToneBetter'
    : tone === 'bad'
      ? 'trendsLineupToneWorse'
      : 'trendsLineupToneAround';
}

/** Tekstsleutel van een teken-toon: positief / rond 0 / negatief (bij +/-, niet "dan team"). */
export function toneKeyOfSign(tone: Tone): StringKey {
  return tone === 'good'
    ? 'trendsToneSignPositive'
    : tone === 'bad'
      ? 'trendsToneSignNegative'
      : 'trendsToneSignAround';
}

// ---- Tekst en opmaak ----

export function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

/** Vult `{naam}`-plaatshouders in een vertaalde tekst. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function gamesText(lang: Lang, n: number): string {
  return n === 1 ? t(lang, 'trendsGamesOne') : fill(t(lang, 'trendsGamesMany'), { n });
}

export function formatDate(iso: string, lang: Lang): string {
  try {
    return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'nl-NL');
  } catch {
    return '';
  }
}

/** Geheel getal met expliciet teken, zoals de +/--tegel ("+7", "0", "-3"). */
export function fmtSignedInt(n: number): string {
  const rounded = Math.round(n);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export function fmtOne(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** Rugnummer van een speler: actuele roster eerst, anders de nieuwste spelerssnapshot, anders '?'. */
export function nrFor(rosterId: number, games: AnalysisGame[], roster: RosterPlayer[]): string {
  const fromRoster = roster.find((p) => p.id === rosterId);
  if (fromRoster) return String(fromRoster.nr);
  for (const g of games) {
    const p = g.players.find((pl) => pl.rosterId === rosterId);
    if (p) return String(p.nr);
  }
  return '?';
}

/** Lineuplabel: rugnummers oplopend, bijv. "1-2-3-4-5". */
export function lineupLabel(
  rosterIds: readonly number[],
  games: AnalysisGame[],
  roster: RosterPlayer[],
): string {
  return rosterIds
    .map((id) => nrFor(id, games, roster))
    .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))
    .join('-');
}

/** Sleutel voor testids: `rosterId`'s met een streepje ("1-2-3-4-5"). */
export function lineupKey(rosterIds: readonly number[]): string {
  return rosterIds.join('-');
}

// ---- Snelfilters (gedeeld wedstrijdfilter) ----

/** ID's van de `n` nieuwste afgeronde wedstrijden (de lopende wedstrijd telt niet mee). */
export function latestCompletedGameIds(games: readonly AnalysisGame[], n: number): Set<string> {
  const completed = games.filter((g) => !g.isCurrent);
  completed.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  return new Set(completed.slice(0, n).map((g) => g.id));
}

/** Het ID van de lopende wedstrijd (met segmenten), of `null` als die er niet is. */
export function currentGameId(games: readonly AnalysisGame[]): string | null {
  return games.find((g) => g.isCurrent)?.id ?? null;
}

/**
 * Komt de huidige selectie overeen met `target`? `gameIds === null` ("alles")
 * telt als gelijk wanneer `target` alle wedstrijden bevat.
 */
export function selectionEquals(
  gameIds: Set<string> | null,
  target: ReadonlySet<string>,
  games: readonly AnalysisGame[],
): boolean {
  if (target.size === 0) return false;
  if (gameIds === null) {
    return games.length === target.size && games.every((g) => target.has(g.id));
  }
  return gameIds.size === target.size && [...target].every((id) => gameIds.has(id));
}
