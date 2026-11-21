import type { ActiveGame } from '../../domain/game/types';
import type { ClassificationConfig } from '../../domain/game/tracking';
import {
  QUARTER_LINEUP_SIZE,
  quarterStartOptions,
  type QuarterStartKind,
  type QuarterStartOption,
} from '../../domain/game/quarterStart';
import { translate, type Lang, type StringKey } from '../../i18n/strings';

/**
 * Keuze van de opstelling voor het volgende kwart (bouwplan R3): zoals het veld nu staat,
 * volgens het wisselschema of zelf samenstellen. Per optie de klassesom (groen past, rood te
 * hoog: waarschuwen maar toestaan) en wie er t.o.v. de huidige vloer in/uit gaat. Alleen
 * weergave en keuze; het vastleggen gebeurt via `closeQuarter({ nextOnCourt })` door de aanroeper.
 */
export interface QuarterLineupChoiceProps {
  lang: Lang;
  game: ActiveGame;
  classification: ClassificationConfig;
  periodLabel: string;
  nextQuarter: number;
  /** Opstelling uit het wisselschema voor het volgende kwart; `null` = geen schema/blok. */
  planLineup: string[] | null;
  kind: QuarterStartKind;
  custom: string[];
  onKindChange: (kind: QuarterStartKind) => void;
  onCustomChange: (custom: string[]) => void;
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

const LABEL_KEY: Record<QuarterStartKind, StringKey> = {
  field: 'quarterStartField',
  plan: 'quarterStartPlan',
  custom: 'quarterStartCustom',
};

export function QuarterLineupChoice({
  lang,
  game,
  classification,
  periodLabel,
  nextQuarter,
  planLineup,
  kind,
  custom,
  onKindChange,
  onCustomChange,
}: QuarterLineupChoiceProps) {
  const t = (key: StringKey) => translate(lang, key);
  const period = periodLabel || t('quarterLabel');
  const participants = game.players.filter((p) => p.participate);
  const name = (id: string) => participants.find((p) => p.id === id)?.naam ?? '?';
  const options = quarterStartOptions(game, classification, planLineup, custom);

  function diffText(option: QuarterStartOption): string | null {
    if (option.kind === 'field') return null;
    if (option.kind === 'custom' && option.lineup.length !== QUARTER_LINEUP_SIZE) return null;
    if (option.ins.length === 0) return t('quarterStartNoChange');
    return fill(t('quickPlanInOut'), {
      ins: option.ins.map(name).join(', '),
      outs: option.outs.map(name).join(', '),
    });
  }

  function toggleCustom(id: string) {
    if (custom.includes(id)) {
      onCustomChange(custom.filter((c) => c !== id));
    } else if (custom.length < QUARTER_LINEUP_SIZE) {
      onCustomChange([...custom, id]);
    }
  }

  return (
    <div
      className="quarter-start"
      role="radiogroup"
      aria-label={fill(t('quarterStartTitle'), { period, n: nextQuarter })}
      data-testid="quarter-start"
    >
      <h3 className="quarter-start__title">
        {fill(t('quarterStartTitle'), { period, n: nextQuarter })}
      </h3>
      {options.map((option) => {
        const on = option.kind === kind;
        const diff = diffText(option);
        return (
          <div
            key={option.kind}
            className={`quarter-start__option${on ? ' quarter-start__option--on' : ''}`}
          >
            <button
              type="button"
              role="radio"
              aria-checked={on}
              className="quarter-start__pick"
              data-testid={`quarter-start-option-${option.kind}`}
              onClick={() => onKindChange(option.kind)}
            >
              <strong>{t(LABEL_KEY[option.kind])}</strong>
              {option.kind !== 'custom' ? (
                <span
                  className="quarter-start__names"
                  data-testid={`quarter-start-names-${option.kind}`}
                >
                  {option.lineup.map(name).join(', ')}
                </span>
              ) : (
                <span className="quarter-start__names" data-testid="quarter-start-count">
                  {fill(t('quarterStartCustomCount'), { n: custom.length })}
                </span>
              )}
              {diff != null ? (
                <span
                  className="quarter-start__diff"
                  data-testid={`quarter-start-diff-${option.kind}`}
                >
                  {diff}
                </span>
              ) : null}
              {classification.useClassLimit && option.sum != null && option.allowed != null ? (
                <span
                  className={`quarter-start__class ${option.over ? 'quarter-start__class--over' : 'quarter-start__class--ok'}`}
                  data-testid={`quarter-start-class-${option.kind}`}
                >
                  {fill(t('quarterStartClass'), {
                    sum: option.sum.toFixed(1),
                    allowed: option.allowed.toFixed(1),
                  })}
                  {option.over ? ` · ${t('quarterStartOver')}` : ''}
                </span>
              ) : null}
            </button>
            {option.kind === 'custom' && on ? (
              <div className="quarter-start__custom" data-testid="quarter-start-custom">
                <p className="quick-sheet__meta">{t('quarterStartCustomHint')}</p>
                <div className="quick-grid">
                  {participants.map((p) => {
                    const sel = custom.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`chip quick-chip${sel ? ' chip--selected' : ''}`}
                        aria-pressed={sel}
                        data-testid={`quarter-start-custom-${p.id}`}
                        onClick={() => toggleCustom(p.id)}
                      >
                        <span className="chip__nr">{p.nr}</span>
                        <span className="chip__name">{p.naam}</span>
                      </button>
                    );
                  })}
                </div>
                {custom.length !== QUARTER_LINEUP_SIZE ? (
                  <p className="settings-error" role="alert" data-testid="quarter-start-need">
                    {t('quarterStartCustomNeed')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
