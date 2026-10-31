import { useMemo } from 'preact/hooks';
import { fmtPlusMinus, fmtSeconds } from '../../domain/stats/format';
import {
  computePlayerQuarterMinutes,
  computeQuarterSplits,
  type PlayerQuarterAvg,
  type QuarterRow,
} from '../../domain/trends/quarterInsights';
import {
  fill,
  fmtOne,
  fmtSignedInt,
  t,
  toneKeyOfSign,
  toneOfSign,
  toneSymbol,
  type Tone,
  type TrendsViewProps,
} from './trendsShared';

/**
 * Weergave "Kwarten" (T5): resultaat per kwart en gemiddelde minuten per kwart
 * per speler. Alles komt uit `computeQuarterSplits` en
 * `computePlayerQuarterMinutes` (gememoiseerd); geen opslag, geen extra reads.
 *
 * - Kaart "Kwarten: +/- per 10 min" (of totaal volgens `props.per10`): per
 *   kwart minuten, waarde, Voor/Tegen, een balk rond 0 en de toon op het
 *   TEKEN van +/- per 10 min (positief/rond 0/negatief; het verschil met het
 *   teamgemiddelde `props.lineups.team` staat alleen als kleine tekst). De toon is
 *   altijd symbool + tekst (▲ ● ▼), kleur is nooit de enige aanwijzing. Een
 *   kwart zonder segmenten toont "geen data" zonder waarde en zonder toon.
 *   Een kwart met minder speeltijd dan de drempel (`minSec`, §E.6) toont alleen
 *   het ruwe totaal ("+3 in 1:00") met het label "te weinig data": geen
 *   waarde per 10, geen balk en geen toon.
 * - Kaart "Minuten per kwart per speler": tabel met m:ss per cel; de
 *   schaduw (donkerder = meer minuten) is alleen versterking. Spelers zonder
 *   speeltijd krijgen geen rij. De tabel scrolt horizontaal binnen de
 *   container, nooit de pagina.
 * - Het aantal kwarten volgt de data (`quarterCount`), niet een vaste 4.
 *
 * Invoer: `TrendsViewProps`; gelezen worden `lang`, `games`, `gameIds`,
 * `per10`, `minSec`, `roster` en `lineups.team`.
 */
export function QuartersView(props: TrendsViewProps) {
  const { lang, games, gameIds, per10, minSec, roster, lineups } = props;

  const rows = useMemo(() => computeQuarterSplits(games, gameIds), [games, gameIds]);
  const minutes = useMemo(
    () => computePlayerQuarterMinutes(games, gameIds, roster),
    [games, gameIds, roster],
  );
  const hasData = rows.some((r) => r.seconds > 0);

  if (!hasData) {
    return (
      <div className="trends-quarters" data-testid="trends-quarters">
        <div className="card trends-empty-state" data-testid="trends-quarters-empty">
          <div className="sm trends-empty-state__title">
            {t(lang, 'trendsQuartersEmptyNoDataTitle')}
          </div>
          <p className="xs mut2">{t(lang, 'trendsQuartersEmptyNoDataText')}</p>
        </div>
      </div>
    );
  }

  const teamPer10 = lineups.team.pmPer10;
  const withData = rows.filter((r) => r.pmPer10 !== null && !isLow(r, minSec));
  const max = Math.max(1, ...withData.map((r) => Math.abs(r.pmPer10 ?? 0)));

  return (
    <div className="trends-quarters" data-testid="trends-quarters">
      <div className="card trends-tov-lineups" data-testid="trends-quarters-card">
        <div className="sm trends-tov-lineups__title" data-testid="trends-quarters-title">
          {t(lang, per10 ? 'trendsQuartersTitlePer10' : 'trendsQuartersTitleTotal')}
        </div>
        <div className="xs mut2">{t(lang, 'trendsQuartersHint')}</div>
        <div className="xs mut2" data-testid="trends-quarters-teamavg">
          {fill(t(lang, 'trendsQuartersTeamAvg'), {
            value: teamPer10 === null ? '–' : fmtPlusMinus(teamPer10),
          })}
        </div>
        <ol
          className="trends-lineup-list trends-quarters-list"
          aria-label={t(lang, 'trendsQuartersListLabel')}
          data-testid="trends-quarters-list"
        >
          {rows.map((r) => (
            <QuarterItem key={r.quarter} row={r} props={props} teamPer10={teamPer10} max={max} />
          ))}
        </ol>
        <p className="xs mut2 trends-legend" data-testid="trends-quarters-legend">
          {t(lang, 'trendsQuartersLegend')}
        </p>
      </div>

      <MinutesCard props={props} rows={rows} minutes={minutes} />
    </div>
  );
}

/** Kwart met speeltijd, maar onder de drempel (gelijk aan de drempel telt mee). */
function isLow(r: QuarterRow, minSec: number): boolean {
  return minSec > 0 && r.seconds > 0 && r.seconds < minSec;
}

function QuarterItem({
  row: r,
  props,
  teamPer10,
  max,
}: {
  row: QuarterRow;
  props: TrendsViewProps;
  teamPer10: number | null;
  max: number;
}) {
  const { lang, per10, minSec } = props;
  const name = fill(t(lang, 'trendsQuartersRowName'), { n: r.quarter });
  const games = fill(t(lang, 'trendsQuartersGames'), { n: r.games });
  const testid = `trends-quarter-${r.quarter}`;

  if (r.pmPer10 === null || r.pfPer10 === null || r.paPer10 === null) {
    return (
      <li
        className="trends-tov-row trends-lineup-row trends-quarter-row"
        data-testid={testid}
        aria-label={fill(t(lang, 'trendsQuartersAriaNoData'), { n: r.quarter })}
      >
        <div className="trends-tov-row__top">
          <span>
            {name} <span className="mut2">· {fmtSeconds(r.seconds)}</span>
          </span>
          <b
            className="trends-tov-row__v trends-tov-row__v--flat"
            data-testid={`trends-quarter-value-${r.quarter}`}
          >
            {t(lang, 'trendsQuartersNoData')}
          </b>
        </div>
      </li>
    );
  }

  if (isLow(r, minSec)) {
    const raw = fill(t(lang, 'trendsLineupLowPm'), {
      value: fmtSignedInt(r.pm),
      time: fmtSeconds(r.seconds),
    });
    return (
      <li
        className="trends-tov-row trends-lineup-row trends-quarter-row"
        data-testid={testid}
        data-low="true"
        aria-label={fill(t(lang, 'trendsFixBQuarterLowAria'), {
          n: r.quarter,
          value: fmtSignedInt(r.pm),
          time: fmtSeconds(r.seconds),
        })}
      >
        <div className="trends-tov-row__top">
          <span>
            {name}{' '}
            <span className="mut2">
              · {fmtSeconds(r.seconds)} · {games}
            </span>
          </span>
          <b
            className="trends-tov-row__v trends-tov-row__v--flat"
            data-testid={`trends-quarter-value-${r.quarter}`}
          >
            {raw}
          </b>
        </div>
        <div className="xs mut2" data-testid={`trends-quarter-low-${r.quarter}`}>
          {t(lang, 'trendsFixBQuarterLow')}
        </div>
      </li>
    );
  }

  const delta = teamPer10 === null ? 0 : r.pmPer10 - teamPer10;
  const tone: Tone = toneOfSign(r.pmPer10);
  const value = per10 ? fmtPlusMinus(r.pmPer10) : fmtSignedInt(r.pm);
  const aria = fill(t(lang, per10 ? 'trendsQuartersAriaPer10' : 'trendsQuartersAriaTotal'), {
    n: r.quarter,
    time: fmtSeconds(r.seconds),
    value,
    tone: t(lang, toneKeyOfSign(tone)),
  });
  return (
    <li
      className="trends-tov-row trends-lineup-row trends-quarter-row"
      data-testid={testid}
      data-tone={tone}
      aria-label={aria}
    >
      <div className="trends-tov-row__top">
        <span>
          {name}{' '}
          <span className="mut2">
            · {fmtSeconds(r.seconds)} · {games}
          </span>
        </span>
        <span className="trends-lineup-val">
          <span className="trends-lineup-sym" aria-hidden="true">
            {toneSymbol(tone)}
          </span>
          <b
            className={`trends-tov-row__v trends-tov-row__v--${tone}`}
            data-testid={`trends-quarter-value-${r.quarter}`}
          >
            {value}
          </b>
        </span>
      </div>
      <QuarterMeter value={r.pmPer10} max={max} tone={tone} />
      <div className="xs mut2" data-testid={`trends-quarter-detail-${r.quarter}`}>
        {per10
          ? fill(t(lang, 'trendsQuartersForAgainstPer10'), {
              pf: fmtOne(r.pfPer10),
              pa: fmtOne(r.paPer10),
            })
          : fill(t(lang, 'trendsQuartersForAgainstTotal'), { pf: r.pf, pa: r.pa })}
      </div>
      <div className="xs mut2" data-testid={`trends-quarter-tone-${r.quarter}`}>
        <span aria-hidden="true">{toneSymbol(tone)} </span>
        {t(lang, toneKeyOfSign(tone))}
        {teamPer10 === null
          ? ''
          : ` · ${fill(t(lang, 'trendsQuartersVsTeam'), { delta: fmtPlusMinus(delta) })}`}
      </div>
    </li>
  );
}

/** Balk gecentreerd rond 0; alleen decoratie (`aria-hidden`). */
function QuarterMeter({ value, max, tone }: { value: number; max: number; tone: Tone }) {
  const ratio = Math.min(1, Math.abs(value) / max);
  const width = `${(ratio * 50).toFixed(1)}%`;
  const style =
    value >= 0 ? { left: '50%', width } : { left: `${(50 - ratio * 50).toFixed(1)}%`, width };
  return (
    <div className="trends-tov-bar trends-meter trends-meter--centered" aria-hidden="true">
      <span className="trends-meter__zero" />
      <div
        className={`trends-tov-bar__fill trends-tov-bar__fill--${tone} trends-meter__fill`}
        style={style}
      />
    </div>
  );
}

function MinutesCard({
  props,
  rows,
  minutes,
}: {
  props: TrendsViewProps;
  rows: QuarterRow[];
  minutes: Map<number, PlayerQuarterAvg[]>;
}) {
  const { lang, roster } = props;
  const players = roster
    .filter((p) => minutes.has(p.id))
    .sort((a, b) => (parseInt(a.nr, 10) || 0) - (parseInt(b.nr, 10) || 0) || a.id - b.id);
  const maxSec = Math.max(1, ...players.flatMap((p) => minutes.get(p.id)!.map((c) => c.avgSec)));
  // Totaal = som van de kwartgemiddelden; elk kwart deelt dezelfde noemer
  // (gespeelde wedstrijden van de speler), dus dit is de gemiddelde totale speeltijd.
  const totalOf = (id: number) => minutes.get(id)!.reduce((sum, c) => sum + c.avgSec, 0);
  const maxTotal = Math.max(1, ...players.map((p) => totalOf(p.id)));

  return (
    <div className="card trends-qmin" data-testid="trends-qmin-card">
      <div className="sm trends-tov-lineups__title">{t(lang, 'trendsQuartersMinTitle')}</div>
      <div className="xs mut2" data-testid="trends-qmin-hint">
        {t(lang, 'trendsQuartersMinHint')}
      </div>
      {players.length === 0 ? (
        <p className="xs mut2" data-testid="trends-qmin-none">
          {t(lang, 'trendsQuartersMinNone')}
        </p>
      ) : (
        <div
          className="trends-qmin__scroll"
          role="region"
          // Een scrollbaar gebied moet focusbaar zijn (axe: scrollable-region-focusable).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          aria-label={t(lang, 'trendsQuartersMinRegion')}
          data-testid="trends-qmin-scroll"
        >
          <table className="trends-qmin__table" data-testid="trends-qmin-table">
            <thead>
              <tr>
                <th scope="col">{t(lang, 'trendsQuartersColPlayer')}</th>
                {rows.map((r) => (
                  <th key={r.quarter} scope="col">
                    <abbr title={fill(t(lang, 'trendsQuartersColFull'), { n: r.quarter })}>
                      {fill(t(lang, 'trendsQuartersColShort'), { n: r.quarter })}
                    </abbr>
                  </th>
                ))}
                <th scope="col" className="trends-qmin__total" data-testid="trends-qmin-total-head">
                  {t(lang, 'trendsQuartersColTotal')}
                </th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id} data-testid={`trends-qmin-row-${p.id}`}>
                  <th scope="row">
                    #{p.nr} {p.naam}
                  </th>
                  {minutes.get(p.id)!.map((c) => {
                    const share = Math.round((c.avgSec / maxSec) * 40);
                    return (
                      <td
                        key={c.quarter}
                        className="trends-qmin__cell"
                        data-testid={`trends-qmin-${p.id}-${c.quarter}`}
                        style={{
                          background: `color-mix(in srgb, var(--lt-color-accent) ${share}%, transparent)`,
                        }}
                      >
                        {fmtSeconds(Math.round(c.avgSec))}
                      </td>
                    );
                  })}
                  <td
                    className="trends-qmin__cell trends-qmin__total"
                    data-testid={`trends-qmin-${p.id}-total`}
                    style={{
                      background: `color-mix(in srgb, var(--lt-color-accent) ${Math.round((totalOf(p.id) / maxTotal) * 40)}%, transparent)`,
                    }}
                  >
                    {fmtSeconds(Math.round(totalOf(p.id)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
