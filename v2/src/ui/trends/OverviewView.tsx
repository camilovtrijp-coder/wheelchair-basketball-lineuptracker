import { useMemo } from 'preact/hooks';
import { fmtPlusMinus, fmtSeconds } from '../../domain/stats/format';
import type { AnalysisGame } from '../../domain/stats/types';
import {
  computeClassProfile,
  computeOverLimitTime,
  type ClassBucket,
  type ClassBucketRow,
  type ClassProfile,
  type OverLimitTime,
} from '../../domain/trends/classProfile';
import {
  computeDataQualityWarnings,
  type DataQualityWarning,
} from '../../domain/trends/dataQuality';
import { selectGames } from '../../domain/trends/trendsScope';
import { computeTurnoverSummary, type TurnoverSummary } from '../../domain/trends/turnoverSummary';
import type { StringKey } from '../../i18n/strings';
import {
  fill,
  fmtOne,
  fmtSignedInt,
  formatDate,
  gamesText,
  t,
  toneKey,
  toneOfDelta,
  toneSymbol,
  type Tone,
  type TrendsViewProps,
} from './trendsShared';

/**
 * Weergave "Overzicht" (T3): de teamkaart "Totaal turnovers" (ongewijzigd,
 * testids `trends-tov-*`) en kaartjes met team +/-, Voor, Tegen en turnovers
 * per 10 min (of totaal, volgens de chip "Per 10 min"), plus speeltijd en
 * aantal wedstrijden. Alles komt uit `props.lineups.team` en
 * `computeTurnoverSummary`; er is geen eigen rekenlogica.
 *
 * T6 voegt toe: kaart "Classificatie en resultaat" en kaart "Tijd over de
 * limiet" (alleen met klassegrens) en het blok "Datakwaliteit" (altijd, alleen
 * bij waarschuwingen). Alle getallen komen uit `classProfile.ts` en
 * `dataQuality.ts`; deze weergave rekent niets zelf uit en slaat niets op.
 *
 * Invoer: `TrendsViewProps` (zie `trendsShared.ts`). Deze weergave leest
 * `lang`, `games`, `gameIds`, `per10` en `lineups`.
 */
export function OverviewView(props: TrendsViewProps) {
  const { lang, games, gameIds, per10, minSec, useClassLimit, lineups } = props;
  const team = lineups.team;
  const gameCount = useMemo(() => selectGames(games, gameIds).length, [games, gameIds]);
  const summary = useMemo(() => computeTurnoverSummary(games, gameIds), [games, gameIds]);
  const hasTime = team.seconds > 0;
  const classProfile = useMemo(
    () => (useClassLimit ? computeClassProfile(games, gameIds, minSec) : null),
    [useClassLimit, games, gameIds, minSec],
  );
  const overLimit = useMemo(
    () => (useClassLimit ? computeOverLimitTime(games, gameIds) : []),
    [useClassLimit, games, gameIds],
  );
  const warnings = useMemo(() => computeDataQualityWarnings(games, gameIds), [games, gameIds]);

  const unit = per10 ? t(lang, 'trendsUnitPer10') : t(lang, 'trendsUnitTotal');
  const otherUnit = per10 ? t(lang, 'trendsUnitTotal') : t(lang, 'trendsUnitPer10');

  return (
    <div className="trends-overview" data-testid="trends-overview">
      <TurnoverSummaryBanner summary={summary} lang={lang} />

      <div className="card trends-team" data-testid="trends-team-card">
        <div className="sm trends-team__title">{t(lang, 'trendsOverviewTeamTitle')}</div>
        <div className="xs mut2" data-testid="trends-team-meta">
          {gamesText(lang, gameCount)} ·{' '}
          {fill(t(lang, 'trendsOverviewPlayTime'), { time: fmtSeconds(team.seconds) })}
        </div>
        {hasTime ? (
          <div className="trends-kpis">
            <Kpi
              testId="trends-team-pm"
              label={`${t(lang, 'trendsOverviewPm')} ${unit}`}
              value={per10 ? fmtPlusMinus(team.pmPer10 ?? 0) : fmtSignedInt(team.pm)}
              sub={`${otherUnit} ${per10 ? fmtSignedInt(team.pm) : fmtPlusMinus(team.pmPer10 ?? 0)}`}
            />
            <Kpi
              testId="trends-team-for"
              label={`${t(lang, 'trendsFor')} ${unit}`}
              value={per10 ? fmtOne(team.pfPer10 ?? 0) : String(team.pf)}
              sub={`${otherUnit} ${per10 ? team.pf : fmtOne(team.pfPer10 ?? 0)}`}
            />
            <Kpi
              testId="trends-team-against"
              label={`${t(lang, 'trendsAgainst')} ${unit}`}
              value={per10 ? fmtOne(team.paPer10 ?? 0) : String(team.pa)}
              sub={`${otherUnit} ${per10 ? team.pa : fmtOne(team.paPer10 ?? 0)}`}
            />
            {summary.tracked ? (
              <Kpi
                testId="trends-team-tov"
                label={`${t(lang, 'trendsOverviewTov')} ${unit}`}
                value={per10 ? fmtOne(team.tovPer10 ?? 0) : String(team.tov)}
                sub={`${otherUnit} ${per10 ? team.tov : fmtOne(team.tovPer10 ?? 0)}`}
              />
            ) : null}
          </div>
        ) : (
          <p className="xs mut2" data-testid="trends-team-empty">
            {t(lang, 'trendsOverviewNoTime')}
          </p>
        )}
      </div>

      {classProfile !== null && classProfile.classLimitGames > 0 ? (
        <>
          <ClassProfileCard
            profile={classProfile}
            lang={lang}
            per10={per10}
            minSec={minSec}
            teamPer10={team.pmPer10}
          />
          <OverLimitCard items={overLimit} games={games} lang={lang} />
        </>
      ) : null}

      <DataQualityBlock warnings={warnings} games={games} lang={lang} />
    </div>
  );
}

// ---- T6: classificatieprofiel ----

const CLASS_ROWS: ReadonlyArray<{ bucket: ClassBucket; label: StringKey; help: StringKey }> = [
  { bucket: 'vol', label: 'trendsOverviewClassFull', help: 'trendsOverviewClassFullHelp' },
  { bucket: 'ruimte', label: 'trendsOverviewClassSlack', help: 'trendsOverviewClassSlackHelp' },
  { bucket: 'over', label: 'trendsOverviewClassOver', help: 'trendsOverviewClassOverHelp' },
];

function ClassProfileCard({
  profile,
  lang,
  per10,
  minSec,
  teamPer10,
}: {
  profile: ClassProfile;
  lang: TrendsViewProps['lang'];
  per10: boolean;
  minSec: number;
  teamPer10: number | null;
}) {
  const byBucket = new Map(profile.groups.map((g) => [g.bucket, g] as const));
  const skipped = profile.skippedSegments;
  return (
    <div className="card trends-class" data-testid="trends-class-card">
      <h3 className="sm trends-section__title">{t(lang, 'trendsOverviewClassTitle')}</h3>
      <div className="xs mut2">
        {fill(t(lang, 'trendsOverviewClassMeta'), {
          games: gamesText(lang, profile.classLimitGames),
        })}
      </div>
      <ul className="trends-class__list" aria-label={t(lang, 'trendsOverviewClassListLabel')}>
        {CLASS_ROWS.map(({ bucket, label, help }) => {
          const row = byBucket.get(bucket);
          if (!row) return null;
          return (
            <ClassRow
              key={bucket}
              row={row}
              label={t(lang, label)}
              help={t(lang, help)}
              lang={lang}
              per10={per10}
              minSec={minSec}
              teamPer10={teamPer10}
            />
          );
        })}
      </ul>
      {skipped > 0 ? (
        <p className="xs trends-note trends-note--warn" data-testid="trends-class-skipped">
          <span aria-hidden="true">⚠ </span>
          {skipped === 1
            ? t(lang, 'trendsOverviewClassSkippedOne')
            : fill(t(lang, 'trendsOverviewClassSkippedMany'), { n: skipped })}
        </p>
      ) : null}
      <p className="xs mut2 trends-note" data-testid="trends-class-note">
        {t(lang, 'trendsOverviewClassNote')}
      </p>
    </div>
  );
}

function ClassRow({
  row,
  label,
  help,
  lang,
  per10,
  minSec,
  teamPer10,
}: {
  row: ClassBucketRow;
  label: string;
  help: string;
  lang: TrendsViewProps['lang'];
  per10: boolean;
  minSec: number;
  teamPer10: number | null;
}) {
  const tone: Tone | null =
    row.pmPer10 !== null && teamPer10 !== null ? toneOfDelta(row.pmPer10 - teamPer10, true) : null;
  return (
    <li className="trends-class__row" data-testid={`trends-class-row-${row.bucket}`}>
      <div className="trends-class__head">
        <b>{label}</b>
        <span className="trends-class__time" data-testid={`trends-class-time-${row.bucket}`}>
          {fmtSeconds(row.seconds)}
        </span>
      </div>
      <div className="xs mut2">{help}</div>
      {row.seconds <= 0 ? (
        <div className="trends-class__val xs mut2" data-testid={`trends-class-empty-${row.bucket}`}>
          {t(lang, 'trendsOverviewClassNoTime')}
        </div>
      ) : row.pmPer10 === null ? (
        <div className="trends-class__val" data-testid={`trends-class-low-${row.bucket}`}>
          <b>{t(lang, 'trendsOverviewClassTooLittle')}</b>
          <span className="xs mut2">
            {fill(t(lang, 'trendsOverviewClassTooLittleRaw'), {
              pm: fmtSignedInt(row.pm),
              time: fmtSeconds(row.seconds),
              threshold: fmtSeconds(minSec),
            })}
          </span>
        </div>
      ) : (
        <div className="trends-class__val">
          <b data-testid={`trends-class-value-${row.bucket}`}>
            {per10 ? fmtPlusMinus(row.pmPer10) : fmtSignedInt(row.pm)}
          </b>
          <span className="xs mut2">
            {per10 ? t(lang, 'trendsUnitPer10') : t(lang, 'trendsUnitTotal')}
          </span>
          {tone !== null ? (
            <span
              className={`trends-tone trends-tone--${tone}`}
              data-testid={`trends-class-tone-${row.bucket}`}
            >
              <span aria-hidden="true">{toneSymbol(tone)}</span> {t(lang, toneKey(tone))}
            </span>
          ) : null}
        </div>
      )}
    </li>
  );
}

// ---- T6: tijd over de limiet ----

function gameLabel(game: AnalysisGame | undefined, lang: TrendsViewProps['lang']): string {
  if (!game) return '?';
  const date = formatDate(game.date, lang);
  const opp = game.opponent.trim();
  if (date === '') return opp === '' ? '?' : opp;
  return opp === '' ? date : `${date} (${opp})`;
}

function gameLabels(
  ids: readonly string[],
  games: readonly AnalysisGame[],
  lang: TrendsViewProps['lang'],
): string {
  return ids
    .map((id) =>
      gameLabel(
        games.find((g) => g.id === id),
        lang,
      ),
    )
    .join(', ');
}

function OverLimitCard({
  items,
  games,
  lang,
}: {
  items: OverLimitTime[];
  games: AnalysisGame[];
  lang: TrendsViewProps['lang'];
}) {
  if (items.length === 0) return null;
  return (
    <div className="card trends-overlimit" data-testid="trends-overlimit-card">
      <h3 className="sm trends-section__title">{t(lang, 'trendsOverviewOverLimitTitle')}</h3>
      <p className="xs mut2 trends-note">{t(lang, 'trendsOverviewOverLimitIntro')}</p>
      <ul
        className="trends-overlimit__list"
        aria-label={t(lang, 'trendsOverviewOverLimitListLabel')}
      >
        {items.map((item) => (
          <li
            key={item.gameId}
            className="trends-overlimit__row"
            data-testid={`trends-overlimit-${item.gameId}`}
          >
            <span>
              {gameLabel(
                games.find((g) => g.id === item.gameId),
                lang,
              )}
            </span>
            {item.segments > 0 ? (
              <b className="trends-tone trends-tone--bad">
                <span aria-hidden="true">⚠</span>{' '}
                {fill(t(lang, 'trendsOverviewOverLimitIn'), {
                  time: fmtSeconds(item.seconds),
                  n: item.segments,
                  total: item.totalSegments,
                })}
              </b>
            ) : (
              <span className="mut2">{t(lang, 'trendsOverviewOverLimitNone')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- T6: datakwaliteit ----

/** Zoveel waarschuwingen staan open; daarboven achter een uitklapper. */
const OPEN_WARNING_LIMIT = 3;

function warningText(
  w: DataQualityWarning,
  games: readonly AnalysisGame[],
  lang: TrendsViewProps['lang'],
): string {
  switch (w.code) {
    case 'quarter-without-segments':
      return w.gameIds.length >= w.totalGames
        ? fill(t(lang, 'trendsOverviewWarnQuarterAll'), { quarter: w.quarter })
        : fill(t(lang, 'trendsOverviewWarnQuarterSome'), {
            quarter: w.quarter,
            games: gameLabels(w.gameIds, games, lang),
          });
    case 'playtime-below-total':
      return fill(t(lang, 'trendsOverviewWarnPlaytime'), {
        game: gameLabel(
          games.find((g) => g.id === w.gameId),
          lang,
        ),
        time: fmtSeconds(w.seconds),
        expected: fmtSeconds(w.expectedSeconds),
      });
    case 'zero-length-segments':
      return fill(
        t(lang, w.count === 1 ? 'trendsOverviewWarnZeroOne' : 'trendsOverviewWarnZeroMany'),
        { n: w.count, games: gameLabels(w.gameIds, games, lang) },
      );
    case 'missing-turnovers':
      return fill(t(lang, 'trendsOverviewWarnTurnovers'), {
        games: gameLabels(w.gameIds, games, lang),
      });
    case 'partial-segments-excluded':
      return fill(
        t(lang, w.count === 1 ? 'trendsOverviewWarnPartialOne' : 'trendsOverviewWarnPartialMany'),
        { n: w.count, games: gameLabels(w.gameIds, games, lang) },
      );
  }
}

function DataQualityBlock({
  warnings,
  games,
  lang,
}: {
  warnings: DataQualityWarning[];
  games: AnalysisGame[];
  lang: TrendsViewProps['lang'];
}) {
  if (warnings.length === 0) return null;
  const list = (
    <ul className="trends-quality__list" aria-label={t(lang, 'trendsOverviewQualityListLabel')}>
      {warnings.map((w, i) => (
        <li
          key={`${w.code}-${i}`}
          className="trends-quality__item"
          data-testid="trends-quality-item"
        >
          <span aria-hidden="true">ⓘ</span> <span>{warningText(w, games, lang)}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="card trends-quality" data-testid="trends-quality">
      <h3 className="sm trends-section__title">{t(lang, 'trendsOverviewQualityTitle')}</h3>
      <p className="xs mut2 trends-note">{t(lang, 'trendsOverviewQualityIntro')}</p>
      {warnings.length > OPEN_WARNING_LIMIT ? (
        <details className="trends-quality__details" data-testid="trends-quality-details">
          <summary>{fill(t(lang, 'trendsOverviewQualityToggle'), { n: warnings.length })}</summary>
          {list}
        </details>
      ) : (
        list
      )}
    </div>
  );
}

function Kpi({
  testId,
  label,
  value,
  sub,
}: {
  testId: string;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="trends-kpi">
      <div className="trends-kpi__k">{label}</div>
      <div className="trends-kpi__n" data-testid={testId}>
        {value}
      </div>
      <div className="trends-kpi__sub">{sub}</div>
    </div>
  );
}

function TurnoverSummaryBanner({
  summary,
  lang,
}: {
  summary: TurnoverSummary;
  lang: TrendsViewProps['lang'];
}) {
  const gamesTextValue =
    summary.games === 1
      ? t(lang, 'trendsTovGamesOne')
      : t(lang, 'trendsTovGamesMany').replace('{n}', String(summary.games));
  return (
    <div className="trends-tov-summary" data-testid="trends-tov-summary" role="status">
      <span>
        {t(lang, 'trendsTovTotalLabel')}
        <br />
        <b data-testid="trends-tov-total">{summary.turnovers}</b> {gamesTextValue}
      </span>
      <span className="trends-tov-summary__right">
        {t(lang, 'statsPer10')}
        <br />
        <b data-testid="trends-tov-per10">{summary.per10 === null ? '–' : fmtOne(summary.per10)}</b>
      </span>
    </div>
  );
}
