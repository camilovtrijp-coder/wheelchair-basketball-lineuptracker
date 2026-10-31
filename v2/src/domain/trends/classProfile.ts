import type { AnalysisGame } from '../stats/types';
import { per10, playersByIdOf, segmentRosterIds, selectGames } from './trendsScope';

/**
 * T6 — classificatieprofiel en over-de-limiet-tijd. Additief; verandert geen
 * bestaande statistiek. Gebruikt uitsluitend `Segment.classSum`, `allowed` en
 * `over` (nooit een hardgecodeerde IWBF-grens) en alleen wedstrijden met
 * `AnalysisGame.useClassLimit === true`.
 *
 * Groepen op de ruimte `slack = allowed - classSum` (besluit I.10):
 *  - `over`   : slack < 0              (over de grens);
 *  - `vol`    : 0 <= slack <= 0,5      (op de grens);
 *  - `ruimte` : slack > 0,5            (ruimte over).
 * De drempels hebben een tolerantie van 0,001, gelijk aan `isOverLimit`
 * (`sum > allowed + 0.001`), zodat drijvendekomma-ruis geen groep verspringt.
 *
 * Een segment met een niet-eindige/ontbrekende `classSum` of `allowed`, een
 * negatieve `classSum` of een `allowed <= 0` is ongeldig: het wordt
 * overgeslagen en geteld (`skippedSegments`). PARTIAL-segmenten (onbekende
 * spelersreferentie) worden uitgesloten en apart geteld (`partialSegments`),
 * net als bij `computeLineupStats`.
 */

export type ClassBucket = 'over' | 'vol' | 'ruimte';

export const CLASS_BUCKET_ORDER: readonly ClassBucket[] = ['over', 'vol', 'ruimte'];
const EPS = 0.001;
const FULL_SLACK_MAX = 0.5;

export interface ClassBucketRow {
  bucket: ClassBucket;
  seconds: number;
  pf: number;
  pa: number;
  pm: number;
  /** `pm * 600 / seconds`, alleen als `seconds >= minSec` (en > 0), anders `null`. */
  pmPer10: number | null;
  segments: number;
}

export interface ClassProfile {
  /** Leeg zonder wedstrijden met klassegrens; anders altijd drie rijen in volgorde over, vol, ruimte. */
  groups: ClassBucketRow[];
  /** Segmenten met ongeldige of ontbrekende `classSum`/`allowed` (overgeslagen). */
  skippedSegments: number;
  /** PARTIAL-segmenten (uitgesloten). */
  partialSegments: number;
  /** Aantal gekozen wedstrijden met `useClassLimit`. */
  classLimitGames: number;
}

function isValidNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Bucket voor een segment, of `null` bij ongeldige classificatiewaarden. */
export function classBucketOf(segment: {
  classSum: unknown;
  allowed: unknown;
}): ClassBucket | null {
  const { classSum, allowed } = segment;
  if (!isValidNumber(classSum) || !isValidNumber(allowed)) return null;
  if (classSum < 0 || allowed <= 0) return null;
  const slack = allowed - classSum;
  if (slack < -EPS) return 'over';
  if (slack > FULL_SLACK_MAX + EPS) return 'ruimte';
  return 'vol';
}

export function computeClassProfile(
  games: readonly AnalysisGame[],
  gameIds: ReadonlySet<string> | null,
  minSec: number,
): ClassProfile {
  const selected = selectGames(games, gameIds).filter((g) => g.useClassLimit === true);
  if (selected.length === 0) {
    return { groups: [], skippedSegments: 0, partialSegments: 0, classLimitGames: 0 };
  }
  const acc = new Map<ClassBucket, ClassBucketRow>(
    CLASS_BUCKET_ORDER.map((bucket) => [
      bucket,
      { bucket, seconds: 0, pf: 0, pa: 0, pm: 0, pmPer10: null, segments: 0 },
    ]),
  );
  let skipped = 0;
  let partial = 0;
  for (const game of selected) {
    const byId = playersByIdOf(game);
    for (const segment of game.segments) {
      if (segmentRosterIds(segment, byId) === null) {
        partial += 1;
        continue;
      }
      const bucket = classBucketOf(segment);
      if (bucket === null) {
        skipped += 1;
        continue;
      }
      const row = acc.get(bucket)!;
      row.seconds += segment.durSec;
      row.pf += segment.pf;
      row.pa += segment.pa;
      row.segments += 1;
    }
  }
  const groups = CLASS_BUCKET_ORDER.map((bucket) => {
    const row = acc.get(bucket)!;
    row.pm = row.pf - row.pa;
    row.pmPer10 = row.seconds > 0 && row.seconds >= minSec ? per10(row.pm, row.seconds) : null;
    return row;
  });
  return {
    groups,
    skippedSegments: skipped,
    partialSegments: partial,
    classLimitGames: selected.length,
  };
}

export interface OverLimitTime {
  gameId: string;
  /** Som van `durSec` van segmenten met `over === true`. */
  seconds: number;
  /** Aantal segmenten met `over === true`. */
  segments: number;
  /** Alle segmenten van de wedstrijd (noemer voor de weergave). */
  totalSegments: number;
}

/**
 * Per gekozen wedstrijd met klassegrens de tijd en het aantal segmenten met
 * `over`. Wedstrijden zonder `useClassLimit` zijn niet betekenisvol en komen
 * er niet in voor. De volgorde volgt `games`.
 */
export function computeOverLimitTime(
  games: readonly AnalysisGame[],
  gameIds: ReadonlySet<string> | null,
): OverLimitTime[] {
  return selectGames(games, gameIds)
    .filter((g) => g.useClassLimit === true)
    .map((game) => {
      let seconds = 0;
      let segments = 0;
      for (const s of game.segments) {
        if (s.over === true) {
          seconds += s.durSec;
          segments += 1;
        }
      }
      return { gameId: game.id, seconds, segments, totalSegments: game.segments.length };
    });
}
