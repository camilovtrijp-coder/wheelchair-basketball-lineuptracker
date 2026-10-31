import { useMemo, useState } from 'preact/hooks';
import { fmtPlusMinus, fmtSeconds } from '../../domain/stats/format';
import { computeComboExtremes, type ComboRow } from '../../domain/trends/lineupExtras';
import {
  fill,
  lineupKey,
  lineupLabel,
  t,
  toneKeyOfSign,
  toneOfSign,
  toneSymbol,
  type TrendsViewProps,
} from './trendsShared';

/**
 * Kaart "Beste en slechtste duo's/trio's" (T7). Top 3 en bottom 3 op +/- per
 * 10 min uit `computeComboExtremes`, alleen boven de vaste combinatiedrempel
 * (10:00 totaal over de gekozen wedstrijden, niet de filterbalkdrempel van de
 * vijftallen). Combinaties die altijd samen speelden worden door de domeinfunctie
 * weggelaten; het aantal staat in `excludedAlwaysTogether`. De toon is relatief
 * op het TEKEN van +/- per 10 min (besluit eigenaar 2026-10-31; het teamgemiddelde
 * speelt geen rol) en is altijd symbool + tekst (groen/rood alleen als versterking). De duo/trio-keuze is sessiestate.
 */

/** Vaste drempel voor duo's en trio's (besluit eigenaar): 10:00. */
export const COMBO_MIN_SEC = 600;
const COMBO_TOP_N = 3;

type ComboSize = 2 | 3;

export function LineupComboCard(props: TrendsViewProps) {
  const { lang, games, gameIds, roster, lineups } = props;
  const [size, setSize] = useState<ComboSize>(2);

  const result = useMemo(
    () => computeComboExtremes(games, gameIds, size, COMBO_MIN_SEC, COMBO_TOP_N),
    [games, gameIds, size],
  );

  const minText = fmtSeconds(COMBO_MIN_SEC);
  const teamPm = lineups.team.pmPer10;
  const teamText = teamPm === null ? '–' : fmtPlusMinus(teamPm);
  const kind = t(
    lang,
    size === 2 ? 'trendsLineupsExtraComboKindDuo' : 'trendsLineupsExtraComboKindTrio',
  );
  const empty = result.best.length === 0;

  const renderRow = (side: 'best' | 'worst', r: ComboRow) => {
    const key = lineupKey(r.rosterIds);
    const label = lineupLabel(r.rosterIds, games, roster);
    const tone = toneOfSign(r.pmPer10);
    const aria = fill(t(lang, 'trendsLineupsExtraComboAria'), {
      kind,
      lineup: label,
      time: fmtSeconds(r.seconds),
      value: fmtPlusMinus(r.pmPer10),
      tone: t(lang, toneKeyOfSign(tone)),
    });
    return (
      <li
        key={key}
        className="trends-combo-row"
        data-testid={`trends-combo-${side}-${key}`}
        data-tone={tone}
        aria-label={aria}
      >
        <span className="trends-combo-row__name">
          {label} <span className="mut2">· {fmtSeconds(r.seconds)}</span>
        </span>
        <span className="trends-lineup-val">
          <span className="trends-lineup-sym" aria-hidden="true">
            {toneSymbol(tone)}
          </span>
          <b className={`trends-tov-row__v trends-tov-row__v--${tone}`}>
            {fmtPlusMinus(r.pmPer10)}
          </b>
        </span>
        <span className="xs mut2 trends-combo-row__tone">
          <span aria-hidden="true">{toneSymbol(tone)} </span>
          {t(lang, toneKeyOfSign(tone))}
        </span>
      </li>
    );
  };

  return (
    <section className="card trends-extra-card" data-testid="trends-combo-card">
      <h3 className="sm trends-extra-card__title">{t(lang, 'trendsLineupsExtraComboTitle')}</h3>
      <div
        className="trends-metric"
        role="group"
        aria-label={t(lang, 'trendsLineupsExtraComboSizeLabel')}
      >
        {([2, 3] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`trends-metric__btn${size === s ? ' trends-metric__btn--active' : ''}`}
            data-testid={`trends-combo-size-${s}`}
            aria-pressed={size === s}
            onClick={() => setSize(s)}
          >
            {t(lang, s === 2 ? 'trendsLineupsExtraComboDuos' : 'trendsLineupsExtraComboTrios')}
          </button>
        ))}
      </div>
      <p className="xs mut2" data-testid="trends-combo-hint">
        {fill(t(lang, 'trendsLineupsExtraComboHint'), { min: minText, team: teamText })}
      </p>

      {empty ? (
        <p className="xs mut2" data-testid="trends-combo-empty">
          {fill(
            t(
              lang,
              size === 2 ? 'trendsLineupsExtraComboEmptyDuos' : 'trendsLineupsExtraComboEmptyTrios',
            ),
            { min: minText },
          )}
        </p>
      ) : (
        <>
          <h4 className="xs trends-extra-card__sub">{t(lang, 'trendsLineupsExtraComboBest')}</h4>
          <ol className="trends-combo-list" data-testid="trends-combo-best">
            {result.best.map((r) => renderRow('best', r))}
          </ol>
          <h4 className="xs trends-extra-card__sub">{t(lang, 'trendsLineupsExtraComboWorst')}</h4>
          {result.worst.length === 0 ? (
            <p className="xs mut2" data-testid="trends-combo-noworst">
              {t(lang, 'trendsLineupsExtraComboNoWorst')}
            </p>
          ) : (
            <ol className="trends-combo-list" data-testid="trends-combo-worst">
              {result.worst.map((r) => renderRow('worst', r))}
            </ol>
          )}
        </>
      )}

      <p className="xs mut2 trends-extra-card__note" data-testid="trends-combo-excluded">
        {t(lang, 'trendsLineupsExtraComboExcluded')}
        {result.excludedAlwaysTogether > 0
          ? ` ${fill(t(lang, 'trendsLineupsExtraComboExcludedCount'), { n: result.excludedAlwaysTogether })}`
          : ''}
      </p>
    </section>
  );
}
