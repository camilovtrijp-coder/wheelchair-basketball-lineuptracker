import type { OnOffRow } from '../../domain/trends/onOffImpact';
import type { PlayerStints } from '../../domain/trends/lineupExtras';
import { fmtPlusMinus, fmtSeconds } from '../../domain/stats/format';
import type { Lang, StringKey } from '../../i18n/strings';
import { fill, fmtSignedInt, t, toneOfDelta, toneSymbol, type Tone } from './trendsShared';

/**
 * On/off (T4) en stints (T7) voor de weergave Spelers.
 *
 * Epsilon "rond gemiddelde" voor on/off: |verschil| < 1.0 per 10 min. Dat is
 * bewust ruimer dan de lineup-epsilon (0.5, `FLAT_EPS_PER10`): een on/off-verschil
 * is het verschil van twee ruisige waarden (zeker met een korte off-kant), dus
 * kleine verschillen worden niet als beter/slechter bestempeld.
 *
 * Getoond wordt alleen een oordeel (toon) als de rij gekwalificeerd is: de
 * on-kant >= de drempel uit de filterbalk (`minSec`), de off-kant >= 10:00
 * (besluit I.3; `offMinSecFor`) en er zijn off-minuten.
 * Anders: "Speelde alles" (geen off-tijd) of "Te weinig minuten aan een kant"
 * met alleen de ruwe totalen, zonder waarde per 10 en zonder toon.
 */
export const ON_OFF_FLAT_EPS_PER10 = 1.0;

/** Off-kant van on/off: 0 als de drempel uit staat, anders minstens 10:00 (besluit I.3). */
export function offMinSecFor(minSec: number): number {
  return minSec === 0 ? 0 : Math.max(600, minSec);
}

export function onOffTone(row: OnOffRow): Tone | null {
  if (!row.qualified || row.diffPer10 === null) return null;
  return toneOfDelta(row.diffPer10, true, ON_OFF_FLAT_EPS_PER10);
}

type OnOffKind = 'all' | 'low' | 'judged';

function kindOf(row: OnOffRow): OnOffKind {
  if (row.offPer10 === null) return 'all';
  return row.qualified ? 'judged' : 'low';
}

function toneWord(lang: Lang, tone: Tone): string {
  const key: StringKey =
    tone === 'good'
      ? 'trendsPlayersToneBetter'
      : tone === 'bad'
        ? 'trendsPlayersToneWorse'
        : 'trendsPlayersToneAround';
  return t(lang, key);
}

/** Korte samenvatting in de compacte rij. */
export function OnOffRowSummary({
  row,
  lang,
  id,
}: {
  row: OnOffRow | undefined;
  lang: Lang;
  id: number;
}) {
  if (!row) return null;
  const kind = kindOf(row);
  const testId = `trends-players-row-onoff-${id}`;
  if (kind === 'all') {
    return (
      <span className="trends-players-row__onoff" data-testid={testId} data-kind="all">
        {t(lang, 'trendsPlayersRowAll')}
      </span>
    );
  }
  if (kind === 'low') {
    return (
      <span className="trends-players-row__onoff" data-testid={testId} data-kind="low">
        {t(lang, 'trendsPlayersRowLow')}
      </span>
    );
  }
  const tone = onOffTone(row) as Tone;
  return (
    <span
      className="trends-players-row__onoff"
      data-testid={testId}
      data-kind="judged"
      data-tone={tone}
    >
      <span className={`trends-players-tone--${tone}`} aria-hidden="true">
        {toneSymbol(tone)}
      </span>
      <span>
        {fill(t(lang, 'trendsPlayersRowOnOff'), {
          on: fmtPlusMinus(row.onPer10),
          off: fmtPlusMinus(row.offPer10 as number),
        })}
      </span>
      <span className="sr-only">, {toneWord(lang, tone)}</span>
    </span>
  );
}

/** Uitgeklapt blok "Op en af het veld". */
export function OnOffBlock({
  row,
  lang,
  id,
  naam,
  minSec,
}: {
  row: OnOffRow | undefined;
  lang: Lang;
  id: number;
  naam: string;
  minSec: number;
}) {
  if (!row) return null;
  const kind = kindOf(row);
  const onTime = fmtSeconds(row.onSec);
  const offTime = fmtSeconds(row.offSec);
  const tone = onOffTone(row);

  let aria: string;
  if (kind === 'judged' && tone) {
    aria = fill(t(lang, 'trendsPlayersAriaOnOff'), {
      naam,
      on: fmtPlusMinus(row.onPer10),
      onTime,
      off: fmtPlusMinus(row.offPer10 as number),
      offTime,
      diff: fmtPlusMinus(row.diffPer10 as number),
      tone: toneWord(lang, tone),
    });
  } else if (kind === 'all') {
    aria = fill(t(lang, 'trendsPlayersAriaAll'), { naam, on: fmtPlusMinus(row.onPer10), onTime });
  } else {
    aria = fill(t(lang, 'trendsPlayersAriaLow'), {
      naam,
      onTotal: fmtSignedInt(row.onPm),
      onTime,
      offTotal: fmtSignedInt(row.offPm),
      offTime,
    });
  }

  return (
    <section
      className="trends-players-block"
      data-testid={`trends-players-onoff-${id}`}
      data-kind={kind}
      aria-labelledby={`trends-players-onoff-title-${id}`}
    >
      <h4 id={`trends-players-onoff-title-${id}`} className="trends-players-block__title">
        {t(lang, 'trendsPlayersOnOffTitle')}
      </h4>
      <div role="group" aria-label={aria} data-testid={`trends-players-onoff-group-${id}`}>
        <div className="trends-players-sides">
          <div className="trends-players-side">
            <div className="trends-players-side__k">{t(lang, 'trendsPlayersOnLabel')}</div>
            <div className="trends-players-side__v" data-testid={`trends-players-on-${id}`}>
              {kind === 'low'
                ? fill(t(lang, 'trendsPlayersRawTotal'), {
                    value: fmtSignedInt(row.onPm),
                    time: onTime,
                  })
                : fmtPlusMinus(row.onPer10)}
            </div>
            <div className="trends-players-side__time" data-testid={`trends-players-on-min-${id}`}>
              {kind === 'low' ? '' : `${t(lang, 'trendsPlayersPer10')} · `}
              {onTime}
            </div>
          </div>
          <div className="trends-players-side">
            <div className="trends-players-side__k">{t(lang, 'trendsPlayersOffLabel')}</div>
            {kind === 'all' ? (
              <div className="trends-players-side__v" data-testid={`trends-players-off-${id}`}>
                {t(lang, 'trendsPlayersAll')}
              </div>
            ) : (
              <>
                <div className="trends-players-side__v" data-testid={`trends-players-off-${id}`}>
                  {kind === 'low'
                    ? fill(t(lang, 'trendsPlayersRawTotal'), {
                        value: fmtSignedInt(row.offPm),
                        time: offTime,
                      })
                    : fmtPlusMinus(row.offPer10 as number)}
                </div>
                <div
                  className="trends-players-side__time"
                  data-testid={`trends-players-off-min-${id}`}
                >
                  {kind === 'low' ? '' : `${t(lang, 'trendsPlayersPer10')} · `}
                  {offTime}
                </div>
              </>
            )}
          </div>
        </div>
        {kind === 'judged' && tone ? (
          <div
            className={`trends-players-diff trends-players-tone--${tone}`}
            data-testid={`trends-players-diff-${id}`}
            data-tone={tone}
          >
            <span aria-hidden="true">{toneSymbol(tone)}</span>
            <b data-testid={`trends-players-diff-value-${id}`}>
              {fmtPlusMinus(row.diffPer10 as number)}
            </b>
            <span>
              {t(lang, 'trendsPlayersPer10')} · {toneWord(lang, tone)}
            </span>
          </div>
        ) : null}
      </div>
      {kind === 'all' ? (
        <p className="trends-players-note" data-testid={`trends-players-note-${id}`}>
          {t(lang, 'trendsPlayersAllHint')}
        </p>
      ) : null}
      {kind === 'low' ? (
        <p className="trends-players-note" data-testid={`trends-players-note-${id}`}>
          <b>{t(lang, 'trendsPlayersLow')}</b>{' '}
          {fill(t(lang, 'trendsPlayersLowHint'), {
            on: onTime,
            off: offTime,
            onMin: fmtSeconds(minSec),
            offMin: fmtSeconds(offMinSecFor(minSec)),
          })}
        </p>
      ) : null}
      <p className="trends-players-note">{t(lang, 'trendsPlayersOnOffExplain')}</p>
    </section>
  );
}

/** Uitgeklapt blok "Stints". */
export function StintsBlock({
  stints,
  orderReliable,
  lang,
  id,
  naam,
}: {
  stints: PlayerStints | undefined;
  orderReliable: boolean;
  lang: Lang;
  id: number;
  naam: string;
}) {
  if (!stints) return null;
  const has = stints.stints > 0 && stints.avgSec !== null;
  const avg = has ? fmtSeconds(Math.round(stints.avgSec as number)) : '–';
  const longest = has ? fmtSeconds(Math.round(stints.longestSec)) : '–';
  const aria = fill(t(lang, 'trendsPlayersStintsAria'), {
    naam,
    n: stints.stints,
    avg,
    longest,
  });
  return (
    <section
      className="trends-players-block"
      data-testid={`trends-players-stints-${id}`}
      aria-labelledby={`trends-players-stints-title-${id}`}
    >
      <h4 id={`trends-players-stints-title-${id}`} className="trends-players-block__title">
        {t(lang, 'trendsPlayersStintsTitle')}
      </h4>
      {has ? (
        <div
          role="group"
          aria-label={aria}
          className="trends-players-stints"
          data-testid={`trends-players-stints-group-${id}`}
        >
          <div className="trends-players-side">
            <div className="trends-players-side__k">{t(lang, 'trendsPlayersStintsCount')}</div>
            <div
              className="trends-players-side__v"
              data-testid={`trends-players-stints-count-${id}`}
            >
              {stints.stints}
            </div>
          </div>
          <div className="trends-players-side">
            <div className="trends-players-side__k">{t(lang, 'trendsPlayersStintsAvg')}</div>
            <div className="trends-players-side__v" data-testid={`trends-players-stints-avg-${id}`}>
              {avg}
            </div>
          </div>
          <div className="trends-players-side">
            <div className="trends-players-side__k">{t(lang, 'trendsPlayersStintsLongest')}</div>
            <div
              className="trends-players-side__v"
              data-testid={`trends-players-stints-longest-${id}`}
            >
              {longest}
            </div>
          </div>
        </div>
      ) : (
        <p className="trends-players-note" data-testid={`trends-players-stints-none-${id}`}>
          {t(lang, 'trendsPlayersStintsNone')}
        </p>
      )}
      <p className="trends-players-note">{t(lang, 'trendsPlayersStintsExplain')}</p>
      {orderReliable ? null : (
        <p
          className="trends-players-warn"
          role="note"
          data-testid={`trends-players-stints-warn-${id}`}
        >
          {t(lang, 'trendsPlayersStintsUnreliable')}
        </p>
      )}
    </section>
  );
}
