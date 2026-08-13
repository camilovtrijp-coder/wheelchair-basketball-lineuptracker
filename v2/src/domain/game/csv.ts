import type { CompletedGame, GamePlayer, Segment } from './types';

/**
 * Byte-exacte poort van v1's Nederlandse CSV-contract (index.html
 * `segmentsCsvFor`/`minutesCsvFor`/`combinedCsvFor`/`csvFilenameFor`, zie
 * docs/pr-6.3-plan.md §C/6.3a). Het contract is altijd Nederlands, ongeacht de
 * gekozen interfacetaal (docs/product-compatibility-matrix.md "CSV altijd
 * NL"). De CSV-quoting is bewust niet "verbeterd": alleen het
 * "Opstelling"-veld staat tussen dubbele aanhalingstekens, komma's/quotes in
 * spelernamen worden niet geëscaped — exact v1-gedrag, nodig voor
 * byte-exacte gelijkheid.
 */

/** v1: `fmt()` — "-1:05"/"1:05" (min:ss, met minteken bij negatieve duur). */
function fmt(sec: number): string {
  const neg = sec < 0;
  const abs = Math.abs(sec);
  return `${neg ? '-' : ''}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

/** v1: `slugify()` — gebruikt in de bestandsnaam. */
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'team'
  );
}

/** v1: `segmentsCsvFor()`. */
export function segmentsCsvFor(
  segments: Segment[],
  players: GamePlayer[],
  useClassLimit: boolean,
): string {
  const byId = new Map(players.map((p) => [p.id, p]));
  const lbl = (id: string): string => {
    const p = byId.get(id);
    return p ? `${p.naam} #${p.nr}` : '?';
  };
  const nr = (id: string): string => {
    const p = byId.get(id);
    return p ? p.nr : '?';
  };
  const classCols = useClassLimit ? ',Som classificatie,Toegestane grens,Binnen klassegrens' : '';
  const head = `Opstelling,Kwart,Begin,Eind,Speeltijd,Seconden,Punten voor,Punten tegen,Plusminus${classCols},Lineup code`;
  const rows = segments.map((s) => {
    const lineup = s.lineup.map(lbl).join(' | ');
    const base = `"${lineup}",${s.quarter},${fmt(s.beginSec)},${fmt(s.endSec)},${fmt(s.durSec)},${s.durSec},${s.pf},${s.pa},${s.pf - s.pa}`;
    let classPart = '';
    if (useClassLimit) {
      const ok = !s.over ? 'OK' : 'Te hoog';
      classPart = `,${s.classSum != null ? s.classSum.toFixed(1) : ''},${s.allowed != null ? s.allowed.toFixed(1) : ''},${ok}`;
    }
    const code = [...s.lineup]
      .sort((a, b) => (parseInt(nr(a), 10) || 0) - (parseInt(nr(b), 10) || 0))
      .map(nr)
      .join('-');
    return base + classPart + ',' + code;
  });
  return [head, ...rows].join('\n');
}

/** v1: `minutesCsvFor()`. */
export function minutesCsvFor(
  segments: Segment[],
  players: GamePlayer[],
  useClassLimit: boolean,
): string {
  const play = new Map<string, number>();
  const cnt = new Map<string, number>();
  players.forEach((p) => {
    play.set(p.id, 0);
    cnt.set(p.id, 0);
  });
  segments.forEach((s) => {
    s.lineup.forEach((id) => {
      if (!play.has(id)) {
        play.set(id, 0);
        cnt.set(id, 0);
      }
      play.set(id, (play.get(id) ?? 0) + s.durSec);
      cnt.set(id, (cnt.get(id) ?? 0) + 1);
    });
  });
  const classCols = useClassLimit ? ',Classificatie,Geslacht,Jeugd U19' : '';
  const head = `Speler,Nummer${classCols},Speeltijd,Seconden,Aantal beurten`;
  const rows = players
    .filter((p) => (play.get(p.id) ?? 0) > 0)
    .map((p) => {
      const classPart = useClassLimit
        ? `,${p.kl},${p.vrouw ? 'Vrouw' : 'Man'},${p.jeugd ? 'Ja' : 'Nee'}`
        : '';
      const sec = play.get(p.id) ?? 0;
      return `${p.naam},${p.nr}${classPart},${fmt(sec)},${sec},${cnt.get(p.id) ?? 0}`;
    });
  return [head, ...rows].join('\n');
}

/** v1: `combinedCsvFor()`. */
export function combinedCsvFor(
  segments: Segment[],
  players: GamePlayer[],
  useClassLimit: boolean,
): string {
  return (
    `Opstellingen (+/-${useClassLimit ? ' en classificatie' : ''})\n` +
    segmentsCsvFor(segments, players, useClassLimit) +
    '\n\nSpeeltijd per speler\n' +
    minutesCsvFor(segments, players, useClassLimit)
  );
}

/** v1: `combinedCsvFor()` toegepast op een opgeslagen `CompletedGame` (v1:
 * `exportHistoryGame()` — gebruikt de bevroren snapshotvelden, nooit de
 * actuele instellingen). */
export function combinedCsvForGame(game: CompletedGame): string {
  return combinedCsvFor(game.segments, game.players, game.useClassLimit);
}

/** v1: `csvFilenameFor()` — gebaseerd op het afrondmoment (`game.date`), niet
 * op "vandaag". */
export function csvFilenameFor(game: CompletedGame): string {
  const d = new Date(game.date);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${slugify(game.opponent || 'wedstrijd')}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
}
