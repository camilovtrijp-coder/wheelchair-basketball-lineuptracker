import { useMemo, useState } from 'preact/hooks';
import {
  buildLineupTurnoverView,
  type LineupTurnoverView,
} from '../../application/trends/buildTrendViewModels';
import { fmtPlusMinus, fmtSeconds } from '../../domain/stats/format';
import { sortByDamped, type ConsistencyRow } from '../../domain/trends/lineupExtras';
import type { LineupRow } from '../../domain/trends/lineupInsights';
import type { LineupTurnoverRow } from '../../domain/trends/turnoverSummary';
import { computeTurnoverSummary } from '../../domain/trends/turnoverSummary';
import { orderByTotalPm } from './lineupOrder';
import { LineupComboCard } from './LineupComboCard';
import {
  LineupConsistencyLine,
  LineupSortControl,
  useLineupConsistency,
  type LineupSort,
} from './LineupPmExtras';
import { LineupStartCloseCard } from './LineupStartCloseCard';
import {
  fill,
  fmtOne,
  fmtSignedInt,
  gamesText,
  lineupKey,
  lineupLabel,
  t,
  toneKey,
  toneKeyOfSign,
  toneOfDelta,
  toneOfSign,
  toneSymbol,
  type Tone,
  type TrendsViewProps,
} from './trendsShared';

/**
 * Weergave "Lineups" (T2): lineupkaart met een metriekschakelaar
 * "+/-" | "Voor/Tegen" | "Turnovers".
 *
 * - Sortering: in modus "Per 10 min" op de waarde per 10 (basis van
 *   `computeLineupInsights`); in modus "Totaal" op het getoonde totaal (+/- of
 *   voor min tegen), met minuten aflopend en dan de sleutel als tiebreak.
 *   Turnovers tonen altijd per 10 min (onafhankelijk van de chip).
 * - "+/-" en "Voor/Tegen" komen uit `props.lineups` (`computeLineupInsights`,
 *   vijftallen, drempel = `props.minSec`). De bestaande turnoverkaart is hier
 *   de metriek "Turnovers" en gebruikt dezelfde drempel en dezelfde groep
 *   "Te weinig data" (alleen presentatie via `buildLineupTurnoverView`).
 * - Rijen boven de drempel staan in de ranglijst met minuten, aantal
 *   wedstrijden, waarde (per 10 min of totaal volgens `props.per10`), verschil
 *   t.o.v. het teamgemiddelde (kleine tekst), een balk en de toon (▲ ● ▼ + tekst).
 *   De toon van +/- volgt het TEKEN van de waarde per 10 min (> +0,5 positief,
 *   < -0,5 negatief); Voor/Tegen en turnovers blijven relatief aan het team.
 *   Kleur (groen/rood) is nooit de enige aanwijzing; elke rij heeft een volledige
 *   toegankelijke naam (`aria-label`).
 * - Rijen onder de drempel staan NIET in de ranglijst maar in het ingeklapte
 *   `<details>` "Te weinig data": ruw totaal, geen per-10-waarde, geen toon.
 *
 * Invoer: `TrendsViewProps` (zie `trendsShared.ts`); gelezen worden `lang`,
 * `games`, `gameIds`, `per10`, `minSec`, `roster` en `lineups`.
 */

type Metric = 'pm' | 'pfpa' | 'tov';

const METRICS: readonly { id: Metric; labelKey: Parameters<typeof t>[1] }[] = [
  { id: 'pm', labelKey: 'trendsLineupMetricPm' },
  { id: 'pfpa', labelKey: 'trendsLineupMetricPfPa' },
  { id: 'tov', labelKey: 'trendsLineupMetricTov' },
];

export function LineupsView(props: TrendsViewProps) {
  const { lang, games, gameIds, per10, minSec, roster, lineups } = props;
  const [metric, setMetric] = useState<Metric>('pm');
  // T7: sorteervolgorde van de +/--rijen; sessiestate, niet opgeslagen.
  const [sort, setSort] = useState<LineupSort>('value');

  const tracked = useMemo(() => computeTurnoverSummary(games, gameIds).tracked, [games, gameIds]);
  // Turnovers zijn alleen te kiezen als er turnovers zijn bijgehouden (zoals voorheen de kaart).
  const active: Metric = metric === 'tov' && !tracked ? 'pm' : metric;
  const tovView = useMemo(
    () => (active === 'tov' ? buildLineupTurnoverView(games, gameIds, minSec) : null),
    [active, games, gameIds, minSec],
  );

  // T7: "voorzichtig" sorteert op de gedempte waarde (alleen metriek +/-); de getoonde waarde blijft de gewone.
  const careful = active === 'pm' && sort === 'careful';
  const shownRows = useMemo(
    () => (per10 ? lineups.rows : orderByTotalPm(lineups.rows)),
    [per10, lineups.rows],
  );
  const pmOrdered = useMemo(
    () => (careful ? sortByDamped(lineups.rows) : shownRows),
    [careful, lineups.rows, shownRows],
  );
  const consistency = useLineupConsistency(props, active === 'pm');

  const minText = fmtSeconds(minSec);
  const label = (ids: readonly number[]) => lineupLabel(ids, games, roster);

  const rowsCount = active === 'tov' ? (tovView?.rows.length ?? 0) : lineups.rows.length;
  const belowCount =
    active === 'tov' ? (tovView?.belowThreshold.length ?? 0) : lineups.belowThreshold.length;

  return (
    <div className="trends-lineups" data-testid="trends-lineups">
      <div
        className="trends-metric"
        role="group"
        aria-label={t(lang, 'trendsLineupMetricLabel')}
        data-testid="trends-metric"
      >
        {METRICS.filter((m) => m.id !== 'tov' || tracked).map((m) => (
          <button
            key={m.id}
            type="button"
            className={`trends-metric__btn${active === m.id ? ' trends-metric__btn--active' : ''}`}
            data-testid={`trends-metric-${m.id}`}
            aria-pressed={active === m.id}
            onClick={() => setMetric(m.id)}
          >
            {t(lang, m.labelKey)}
          </button>
        ))}
      </div>

      {minSec === 0 ? (
        <p className="trends-warning" role="note" data-testid="trends-lineup-threshold-warning">
          <span aria-hidden="true">⚠ </span>
          {t(lang, 'trendsLineupNoThresholdWarning')}
        </p>
      ) : null}

      <div
        className="card trends-tov-lineups"
        data-testid={active === 'tov' ? 'trends-tov-lineups' : 'trends-lineup-card'}
      >
        <div className="sm trends-tov-lineups__title" data-testid="trends-lineup-title">
          {t(lang, titleKey(active, per10))}
        </div>
        <div className="xs mut2" data-testid="trends-lineup-hint">
          {t(lang, hintKey(active, per10, careful))}
        </div>
        <div className="xs mut2" data-testid="trends-lineup-teamavg">
          {teamAverageText(props, active, tovView)}
        </div>
        {active === 'pm' && rowsCount > 0 ? (
          <LineupSortControl lang={lang} sort={sort} onChange={setSort} />
        ) : null}

        {rowsCount === 0 && belowCount === 0 ? (
          <p className="xs mut2" data-testid="trends-lineup-empty">
            {t(lang, 'trendsTovLineupsEmpty')}
          </p>
        ) : rowsCount === 0 ? (
          <p className="xs mut2" data-testid="trends-lineup-none-above">
            {fill(t(lang, 'trendsLineupNoneAbove'), { min: minText })}
          </p>
        ) : (
          <ol
            className="trends-lineup-list"
            aria-label={t(lang, 'trendsLineupListLabel')}
            data-testid="trends-lineup-list"
          >
            {active === 'pm'
              ? pmRows(props, pmOrdered, label, consistency)
              : active === 'pfpa'
                ? pfPaRows(props, shownRows, label)
                : tovRows(props, tovView?.rows ?? [], tovView?.averagePer10 ?? null, label)}
          </ol>
        )}

        {rowsCount > 0 ? (
          <p className="xs mut2 trends-legend" data-testid="trends-lineup-legend">
            {t(lang, active === 'pm' ? 'trendsLineupLegendSign' : 'trendsLineupLegend')}
          </p>
        ) : null}
        {active === 'pm' && consistency.size > 0 ? (
          <p className="xs mut2" data-testid="trends-lineup-consistency-note">
            {t(lang, 'trendsLineupsExtraConsistencyNote')}
          </p>
        ) : null}
      </div>

      <p className="xs mut2 trends-explain" data-testid="trends-lineup-explain">
        {fill(t(lang, 'trendsLineupExplain'), {
          min: minSec === 0 ? t(lang, 'trendsFilterThresholdOff') : minText,
        })}
      </p>

      {belowCount > 0 ? (
        <details className="card trends-lowdata" data-testid="trends-lineup-lowdata">
          <summary>
            {belowCount === 1
              ? fill(t(lang, 'trendsLineupLowTitleOne'), { min: minText })
              : fill(t(lang, 'trendsLineupLowTitle'), { n: belowCount, min: minText })}
          </summary>
          <p className="xs mut2">{t(lang, 'trendsLineupLowHint')}</p>
          <ul className="trends-lowdata__list">
            {active === 'tov'
              ? (tovView?.belowThreshold ?? []).map((r) => lowTovRow(props, r, label))
              : lineups.belowThreshold.map((r) => lowRow(props, r, active, label))}
          </ul>
        </details>
      ) : null}

      {/* T7: extra kaarten onder de lineupkaart (duo's/trio's, start- en sluitlineup). */}
      <LineupComboCard {...props} />
      <LineupStartCloseCard {...props} />
      {/* T7 (consistentie en sorteeroptie) staan in de rijen van de +/--lineupkaart: zie LineupPmExtras.tsx. */}
    </div>
  );
}

function titleKey(metric: Metric, per10: boolean): Parameters<typeof t>[1] {
  if (metric === 'pm') return per10 ? 'trendsLineupTitlePm' : 'trendsLineupTitlePmTotal';
  if (metric === 'pfpa') return per10 ? 'trendsLineupTitlePfPa' : 'trendsLineupTitlePfPaTotal';
  // Turnovers staan altijd per 10 min, onafhankelijk van de chip (review-fix M2).
  return 'trendsTovLineupsTitle';
}

function hintKey(metric: Metric, per10: boolean, careful: boolean): Parameters<typeof t>[1] {
  // In Totaal sorteren +/- en Voor/Tegen op het totaal; de "voorzichtig"-sortering heeft eigen uitleg.
  if (metric === 'pm') {
    return per10 || careful ? 'trendsLineupHintPm' : 'trendsFixBHintPmTotal';
  }
  if (metric === 'pfpa') return per10 ? 'trendsLineupHintPfPa' : 'trendsFixBHintPfPaTotal';
  return 'trendsFixBTovHint';
}

function teamAverageText(
  props: TrendsViewProps,
  metric: Metric,
  tovView: LineupTurnoverView | null,
): string {
  const { lang, lineups } = props;
  const team = lineups.team;
  let value: string;
  if (metric === 'pm') {
    value = team.pmPer10 === null ? '–' : fmtPlusMinus(team.pmPer10);
  } else if (metric === 'pfpa') {
    value =
      team.pfPer10 === null || team.paPer10 === null
        ? '–'
        : `${t(lang, 'trendsFor')} ${fmtOne(team.pfPer10)} · ${t(lang, 'trendsAgainst')} ${fmtOne(team.paPer10)}`;
  } else {
    value = tovView?.averagePer10 == null ? '–' : fmtOne(tovView.averagePer10);
  }
  return fill(t(lang, 'trendsLineupTeamAvg'), { value });
}

/** Balk: `centered` = +/- rond een nulstreep; anders van links. Alleen decoratie (`aria-hidden`). */
function Meter({
  value,
  max,
  tone,
  centered,
}: {
  value: number;
  max: number;
  tone: Tone;
  centered: boolean;
}) {
  const ratio = max > 0 ? Math.min(1, Math.abs(value) / max) : 0;
  const style = centered
    ? value >= 0
      ? { left: '50%', width: `${(ratio * 50).toFixed(1)}%` }
      : { left: `${(50 - ratio * 50).toFixed(1)}%`, width: `${(ratio * 50).toFixed(1)}%` }
    : { left: '0', width: `${Math.max(3, ratio * 100).toFixed(1)}%` };
  return (
    <div
      className={`trends-tov-bar trends-meter${centered ? ' trends-meter--centered' : ''}`}
      aria-hidden="true"
    >
      {centered ? <span className="trends-meter__zero" /> : null}
      <div
        className={`trends-tov-bar__fill trends-tov-bar__fill--${tone} trends-meter__fill`}
        style={style}
      />
    </div>
  );
}

function lineupTitle(
  props: TrendsViewProps,
  ids: readonly number[],
  seconds: number,
  games?: number,
) {
  const { lang } = props;
  return (
    <span>
      {lineupLabel(ids, props.games, props.roster)}{' '}
      <span className="mut2">
        · {fmtSeconds(seconds)}
        {games === undefined ? '' : ` · ${gamesText(lang, games)}`}
      </span>
    </span>
  );
}

function pmRows(
  props: TrendsViewProps,
  rows: LineupRow[],
  label: (ids: readonly number[]) => string,
  consistency: Map<string, ConsistencyRow>,
) {
  const { lang, per10, lineups } = props;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.pmPer10)));
  const teamText = lineups.team.pmPer10 === null ? '–' : fmtPlusMinus(lineups.team.pmPer10);
  return rows.map((r) => {
    const key = lineupKey(r.rosterIds);
    // Toon op het teken van +/- per 10 min (besluit eigenaar 2026-10-31); ook in Totaal-modus
    // bepaalt de waarde per 10 min de toon. Het verschil met het team is alleen kleine tekst.
    const tone = toneOfSign(r.pmPer10);
    const aria = fill(t(lang, 'trendsLineupAriaPm'), {
      lineup: label(r.rosterIds),
      time: fmtSeconds(r.seconds),
      value: fmtPlusMinus(r.pmPer10),
      tone: t(lang, toneKeyOfSign(tone)),
    });
    return (
      <li
        key={key}
        className="trends-tov-row trends-lineup-row"
        data-testid={`trends-lineup-${key}`}
        data-tone={tone}
        aria-label={aria}
      >
        <div className="trends-tov-row__top">
          {lineupTitle(props, r.rosterIds, r.seconds, r.games)}
          <span className="trends-lineup-val">
            <span className="trends-lineup-sym" aria-hidden="true">
              {toneSymbol(tone)}
            </span>
            <b
              className={`trends-tov-row__v trends-tov-row__v--${tone}`}
              data-testid={`trends-lineup-value-${key}`}
            >
              {per10 ? fmtPlusMinus(r.pmPer10) : fmtSignedInt(r.pm)}
            </b>
          </span>
        </div>
        <Meter value={r.pmPer10} max={max} tone={tone} centered />
        <div className="xs mut2" data-testid={`trends-lineup-delta-${key}`}>
          <span aria-hidden="true">{toneSymbol(tone)} </span>
          {t(lang, toneKeyOfSign(tone))} ·{' '}
          {fill(t(lang, 'trendsLineupVsTeam'), {
            delta: fmtPlusMinus(r.deltaVsTeamPer10),
            team: teamText,
          })}
          {per10
            ? ''
            : ` · ${fill(t(lang, 'trendsLineupPer10Of'), { value: fmtPlusMinus(r.pmPer10) })}`}
        </div>
        <LineupConsistencyLine
          lang={lang}
          row={consistency.get(key)}
          testId={`trends-lineup-consistency-${key}`}
        />
      </li>
    );
  });
}

function pfPaRows(
  props: TrendsViewProps,
  rows: LineupRow[],
  label: (ids: readonly number[]) => string,
) {
  const { lang, per10, lineups } = props;
  const teamFor = lineups.team.pfPer10 ?? 0;
  const teamAgainst = lineups.team.paPer10 ?? 0;
  const max = Math.max(1, ...rows.flatMap((r) => [r.pfPer10, r.paPer10]));
  return rows.map((r) => {
    const key = lineupKey(r.rosterIds);
    const dFor = r.pfPer10 - teamFor;
    const dAgainst = r.paPer10 - teamAgainst;
    const toneFor = toneOfDelta(dFor, true);
    const toneAgainst = toneOfDelta(dAgainst, false);
    const aria = fill(t(lang, 'trendsLineupAriaPfPa'), {
      lineup: label(r.rosterIds),
      time: fmtSeconds(r.seconds),
      pf: fmtOne(r.pfPer10),
      pfTone: t(lang, toneKey(toneFor)),
      pa: fmtOne(r.paPer10),
      paTone: t(lang, toneKey(toneAgainst)),
    });
    return (
      <li
        key={key}
        className="trends-tov-row trends-lineup-row"
        data-testid={`trends-lineup-${key}`}
        aria-label={aria}
      >
        <div className="trends-tov-row__top">
          {lineupTitle(props, r.rosterIds, r.seconds, r.games)}
        </div>
        <div className="trends-lineup-two">
          <PfPaSide
            lang={lang}
            title={t(lang, 'trendsFor')}
            testId={`trends-lineup-for-${key}`}
            value={per10 ? fmtOne(r.pfPer10) : String(r.pf)}
            per10Value={r.pfPer10}
            delta={dFor}
            tone={toneFor}
            max={max}
          />
          <PfPaSide
            lang={lang}
            title={t(lang, 'trendsAgainst')}
            testId={`trends-lineup-against-${key}`}
            value={per10 ? fmtOne(r.paPer10) : String(r.pa)}
            per10Value={r.paPer10}
            delta={dAgainst}
            tone={toneAgainst}
            max={max}
          />
        </div>
      </li>
    );
  });
}

function PfPaSide({
  lang,
  title,
  testId,
  value,
  per10Value,
  delta,
  tone,
  max,
}: {
  lang: TrendsViewProps['lang'];
  title: string;
  testId: string;
  value: string;
  per10Value: number;
  delta: number;
  tone: Tone;
  max: number;
}) {
  return (
    <div className="trends-lineup-side" data-tone={tone}>
      <div className="xs mut2">{title}</div>
      <div className="trends-lineup-val">
        <span className="trends-lineup-sym" aria-hidden="true">
          {toneSymbol(tone)}
        </span>
        <b className={`trends-tov-row__v trends-tov-row__v--${tone}`} data-testid={testId}>
          {value}
        </b>
      </div>
      <Meter value={per10Value} max={max} tone={tone} centered={false} />
      <div className="xs mut2">
        <span aria-hidden="true">{toneSymbol(tone)} </span>
        {t(lang, toneKey(tone))} · {fmtPlusMinus(delta)}
      </div>
    </div>
  );
}

function tovRows(
  props: TrendsViewProps,
  rows: LineupTurnoverRow[],
  averagePer10: number | null,
  label: (ids: readonly number[]) => string,
) {
  const { lang } = props;
  const max = Math.max(0.1, ...rows.map((r) => r.per10));
  return rows.map((row) => {
    const key = lineupKey(row.rosterIds);
    // Toon in de presentatielaag: dezelfde band (|Δ| < 0,5 per 10) als de andere metrieken; de
    // binaire `row.tone` van het domein belooft geen "rond gemiddelde" (review-fix M5).
    const tone: Tone = toneOfDelta(row.per10 - (averagePer10 ?? row.per10), false);
    const aria = fill(t(lang, 'trendsLineupAriaTov'), {
      lineup: label(row.rosterIds),
      time: fmtSeconds(row.seconds),
      value: fmtOne(row.per10),
      tone: t(lang, toneKey(tone)),
    });
    return (
      <li
        key={key}
        className="trends-tov-row trends-lineup-row"
        data-testid={`trends-tov-lineup-${key}`}
        data-tone={tone}
        aria-label={aria}
      >
        <div className="trends-tov-row__top">
          {lineupTitle(props, row.rosterIds, row.seconds)}
          <span className="trends-lineup-val">
            <span className="trends-lineup-sym" aria-hidden="true">
              {toneSymbol(tone)}
            </span>
            <b
              className={`trends-tov-row__v trends-tov-row__v--${tone}`}
              data-testid={`trends-tov-lineup-value-${key}`}
            >
              {fmtOne(row.per10)}
            </b>
          </span>
        </div>
        <Meter value={row.per10} max={max} tone={tone} centered={false} />
        <div className="xs mut2">
          <span aria-hidden="true">{toneSymbol(tone)} </span>
          {t(lang, toneKey(tone))} · {fill(t(lang, 'trendsFixBTovCount'), { n: row.turnovers })}
        </div>
      </li>
    );
  });
}

function lowRow(
  props: TrendsViewProps,
  r: LineupRow,
  metric: Metric,
  label: (ids: readonly number[]) => string,
) {
  const { lang } = props;
  const key = lineupKey(r.rosterIds);
  const time = fmtSeconds(r.seconds);
  const raw =
    metric === 'pfpa'
      ? fill(t(lang, 'trendsLineupLowPfPa'), { pf: r.pf, pa: r.pa, time })
      : fill(t(lang, 'trendsLineupLowPm'), { value: fmtSignedInt(r.pm), time });
  return (
    <li key={key} className="trends-lowdata__row" data-testid={`trends-lineup-low-${key}`}>
      <span className="trends-lowdata__name">
        {label(r.rosterIds)} <span className="mut2">· {time}</span>
      </span>
      <span className="trends-lowdata__raw">{raw}</span>
    </li>
  );
}

function lowTovRow(
  props: TrendsViewProps,
  r: LineupTurnoverRow,
  label: (ids: readonly number[]) => string,
) {
  const { lang } = props;
  const key = lineupKey(r.rosterIds);
  const time = fmtSeconds(r.seconds);
  return (
    <li key={key} className="trends-lowdata__row" data-testid={`trends-lineup-low-${key}`}>
      <span className="trends-lowdata__name">
        {label(r.rosterIds)} <span className="mut2">· {time}</span>
      </span>
      <span className="trends-lowdata__raw">
        {fill(t(lang, 'trendsLineupLowTov'), { n: r.turnovers, time })}
      </span>
    </li>
  );
}
