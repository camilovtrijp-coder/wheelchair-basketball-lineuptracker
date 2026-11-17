import { useState } from 'preact/hooks';
import type { ActiveGame, GamePlayer } from '../../domain/game/types';
import {
  deriveGameHistory,
  isOverLimit,
  type ClassificationConfig,
} from '../../domain/game/tracking';
import {
  addBlock,
  blockStartSec,
  blockTimeBounds,
  currentBlockIndex,
  diffPlans,
  isLineupEditable,
  planVersusActual,
  playedBlockCount,
  startersEditable,
  moveBlockTime,
  PLAN_TIME_STEP_SEC,
  removeBlock,
  resolveLineup,
  setBlockLineup,
  withQuarterCount,
  type RotationPlan,
} from '../../domain/game/rotationPlan';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { useGameScreenLock } from '../../application/game/useGameScreen';
import { fmtSec } from './LiveTrackingPanel';
import { SheetFrame } from './QuickSheets';
import { QuickPlanChangeList, QuickPlanConfirmSheet } from './QuickPlanConfirm';

/**
 * Schermdeel "Wisselschema" van het Snel-wedstrijdscherm: per kwart de
 * geplande blokken (opstelling + wisselmoment) bekijken en aanpassen. Alles is
 * lokaal en alleen invoerhulp; de echte tijden en opstellingen legt de
 * gebruiker in het wedstrijdscherm vast. Gespeelde blokken en het lopende blok
 * zijn niet meer te bewerken, met één uitzondering: het starters-blok (kwart 1,
 * blok 1) blijft aanpasbaar zolang er nog niets is gespeeld. Gespeelde blokken
 * tonen de werkelijk gespeelde opstelling naast de geplande (afgeleid uit de
 * segmenten). Schema wissen en "Zelfde als vorige wedstrijd" vragen eerst een
 * bevestiging in een Snel-sheet.
 */
export interface QuickPlanEditorProps {
  lang: Lang;
  game: ActiveGame;
  quarterCount: number;
  periodLabel: string;
  classification: ClassificationConfig;
  plan: RotationPlan | null;
  /** Schema van de vorige wedstrijd (voor het overzicht bij bevestigen); `null` = geen. */
  previousPlan: RotationPlan | null;
  canWrite: boolean;
  onPlanChange: (plan: RotationPlan) => void;
  onCreate: () => void;
  onLoadPrevious: () => void;
  onClear: () => void;
  /** Starters (`rosterId`'s) zijn voor het eerste segment aangepast; het live-scherm volgt. */
  onStartersChange?: (lineup: number[]) => void;
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

type Confirm = 'clear' | 'load';
type Selection = { kind: 'court'; index: number } | { kind: 'bench'; rosterId: number };

export function QuickPlanEditor({
  lang,
  game,
  quarterCount,
  periodLabel,
  classification,
  plan,
  previousPlan,
  canWrite,
  onPlanChange,
  onCreate,
  onLoadPrevious,
  onClear,
  onStartersChange,
}: QuickPlanEditorProps) {
  const hasPrevious = previousPlan != null;
  const t = (key: StringKey) => translate(lang, key);
  const period = periodLabel || t('quarterLabel');
  const [quarter, setQuarter] = useState(() =>
    Math.max(1, Math.min(quarterCount, game.curQuarter)),
  );
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<StringKey | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  useGameScreenLock(editIndex != null || confirm != null ? 'dialog' : null);

  const participants = game.players.filter((p) => p.participate);
  const byRoster = (rosterId: number): GamePlayer | undefined =>
    participants.find((p) => p.rosterId === rosterId);
  const label = (rosterId: number) => byRoster(rosterId)?.naam ?? t('quickPlanMissingPlayer');
  const noSegmentsYet = deriveGameHistory(game).segments.length === 0;

  const loadedPreview =
    previousPlan != null ? withQuarterCount(previousPlan, game, quarterCount) : null;
  const confirmSheet =
    confirm === 'clear' ? (
      <QuickPlanConfirmSheet
        lang={lang}
        title={t('quickPlanClearTitle')}
        testId="quick-plan-clear-sheet"
        confirmLabel={t('quickPlanClearConfirm')}
        danger
        onConfirm={() => {
          setConfirm(null);
          setEditIndex(null);
          setSelection(null);
          onClear();
        }}
        onCancel={() => setConfirm(null)}
      >
        <p className="quick-sheet__meta">{t('quickPlanClearBody')}</p>
      </QuickPlanConfirmSheet>
    ) : confirm === 'load' && loadedPreview != null ? (
      <QuickPlanConfirmSheet
        lang={lang}
        title={t('quickPlanLoadTitle')}
        testId="quick-plan-load-sheet"
        confirmLabel={t('quickPlanLoadConfirm')}
        onConfirm={() => {
          setConfirm(null);
          onLoadPrevious();
        }}
        onCancel={() => setConfirm(null)}
      >
        {plan == null ? (
          <p className="quick-sheet__meta">{t('quickPlanLoadBodyNew')}</p>
        ) : (
          <>
            <p className="quick-sheet__meta">{t('quickPlanLoadBodyReplace')}</p>
            <QuickPlanChangeList
              lang={lang}
              changes={diffPlans(plan, loadedPreview)}
              period={period}
              label={label}
            />
          </>
        )}
      </QuickPlanConfirmSheet>
    ) : null;

  if (plan == null) {
    return (
      <section className="quick-plan" data-testid="quick-plan">
        <h3 className="quick-plan__title">{t('quickPlanTitle')}</h3>
        <p className="quick-plan__intro">{t('quickPlanIntro')}</p>
        <div className="quick-plan__actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!canWrite}
            data-testid="quick-plan-create"
            onClick={onCreate}
          >
            {t('quickPlanCreateBtn')}
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={!canWrite || !hasPrevious}
            data-testid="quick-plan-load-previous"
            onClick={() => setConfirm('load')}
          >
            {t('quickPlanLoadPrevious')}
          </button>
        </div>
        {confirmSheet}
      </section>
    );
  }

  const blocks = plan.quarters[String(quarter)] ?? [];
  // Gespeelde blokken zijn dicht. Het lopende blok blijft qua tijd aan te passen (zijn opstelling staat op de vloer).
  const played = playedBlockCount(game, quarter, blocks.length);
  const currentIdx = quarter === game.curQuarter ? currentBlockIndex(game, blocks.length) : -1;

  function previousLineup(i: number): number[] | null {
    if (i > 0) return blocks[i - 1]?.lineup ?? null;
    if (quarter > 1) {
      const before = plan?.quarters[String(quarter - 1)];
      return before?.[before.length - 1]?.lineup ?? null;
    }
    return null;
  }

  function diffText(i: number, lineup: number[]): string {
    const prev = previousLineup(i);
    if (prev == null) return t('quickPlanStarters');
    const ins = lineup.filter((r) => !prev.includes(r));
    const outs = prev.filter((r) => !lineup.includes(r));
    if (ins.length === 0) return t('quickPlanNoChange');
    return fill(t('quickPlanInOut'), {
      ins: ins.map(label).join(', '),
      outs: outs.map(label).join(', '),
    });
  }

  function classText(lineup: number[]): string | null {
    if (!classification.useClassLimit) return null;
    const ids = resolveLineup(game, lineup);
    if (ids == null) return null;
    return fill(t('quickPlanClassSum'), {
      sum: isOverLimit(game, ids, classification).sum.toFixed(1),
    });
  }

  function whenText(i: number): string {
    return fill(t('quickPlanBlockWhen'), {
      begin: fmtSec(blockStartSec(plan as RotationPlan, quarter, i, game.clockDown)),
      end: fmtSec(blocks[i]?.toSec ?? 0),
    });
  }

  function actualWhen(exec: { beginSec: number; endSec: number }): string {
    return fill(t('quickPlanBlockWhen'), {
      begin: fmtSec(exec.beginSec),
      end: fmtSec(exec.endSec),
    });
  }

  function handleAdd() {
    if (!canWrite || plan == null) return;
    if (blocks.length - 1 < played) {
      setNotice('quickPlanAddLocked');
      return;
    }
    // Loopt het laatste blok al, dan splitst het pas vanaf de huidige kloktijd.
    const next = addBlock(
      plan,
      quarter,
      game.clockDown,
      currentIdx === blocks.length - 1 ? game.beginSec : undefined,
    );
    if (next == null) {
      setNotice('quickPlanNoRoom');
      return;
    }
    setNotice(null);
    onPlanChange(next);
  }

  function closeEditor() {
    setEditIndex(null);
    setSelection(null);
  }

  function tapEditChip(next: Selection) {
    if (plan == null || editIndex == null) return;
    const lineup = blocks[editIndex]?.lineup;
    if (lineup == null) return;
    if (selection == null) {
      setSelection(next);
      return;
    }
    if (selection.kind === next.kind) {
      const same =
        selection.kind === 'court' && next.kind === 'court'
          ? selection.index === next.index
          : selection.kind === 'bench' &&
            next.kind === 'bench' &&
            selection.rosterId === next.rosterId;
      setSelection(same ? null : next);
      return;
    }
    const court =
      selection.kind === 'court' ? selection : (next as { kind: 'court'; index: number });
    const bench =
      selection.kind === 'bench' ? selection : (next as { kind: 'bench'; rosterId: number });
    const replaced = lineup.map((r, idx) => (idx === court.index ? bench.rosterId : r));
    onPlanChange(setBlockLineup(plan, quarter, editIndex, replaced));
    // Starters vóór het eerste segment: de opstelling op de vloer volgt het schema.
    if (quarter === 1 && editIndex === 0 && startersEditable(game)) onStartersChange?.(replaced);
    setSelection(null);
  }

  const editing = editIndex != null ? blocks[editIndex] : undefined;
  // De opstelling van het lopende blok staat op de vloer en is hier niet aan te passen.
  // Uitzondering: het starters-blok van kwart 1 zolang er nog niets is gespeeld.
  const lineupLocked =
    editIndex != null && !isLineupEditable(game, quarter, editIndex, blocks.length);
  const startersBlock =
    editIndex === 0 && quarter === 1 && !lineupLocked && editIndex === currentIdx;
  const executions = planVersusActual(game, plan, quarter);
  const editBounds =
    editIndex != null ? blockTimeBounds(plan, quarter, editIndex, game.clockDown) : null;
  // "Eerder" = eerder in de wedstrijd: bij een aflopende klok een hogere kloktijd.
  const earlierDelta = (game.clockDown ? 1 : -1) * PLAN_TIME_STEP_SEC;
  const canEarlier =
    editIndex != null &&
    moveBlockTime(plan, quarter, editIndex, earlierDelta, game.clockDown) !== plan;
  const canLater =
    editIndex != null &&
    moveBlockTime(plan, quarter, editIndex, -earlierDelta, game.clockDown) !== plan;

  return (
    <section className="quick-plan" data-testid="quick-plan">
      <div className="quick-plan__head">
        <h3 className="quick-plan__title">{t('quickPlanTitle')}</h3>
        {noSegmentsYet && hasPrevious ? (
          <button
            type="button"
            className="btn-outline quick-plan__previous"
            disabled={!canWrite}
            data-testid="quick-plan-load-previous"
            onClick={() => setConfirm('load')}
          >
            {t('quickPlanLoadPrevious')}
          </button>
        ) : null}
      </div>
      <p className="quick-plan__note">{t('quickPlanLocalNote')}</p>

      <div className="quick-plan__tabs" role="group" aria-label={t('quickPlanTitle')}>
        {Array.from({ length: quarterCount }, (_, i) => i + 1).map((q) => (
          <button
            key={q}
            type="button"
            className={q === quarter ? 'quick-plan__tab quick-plan__tab--on' : 'quick-plan__tab'}
            aria-pressed={q === quarter}
            data-testid={`quick-plan-tab-${q}`}
            onClick={() => {
              setQuarter(q);
              setNotice(null);
            }}
          >
            {fill(t('quickPlanQuarterTab'), { period, n: q })}
          </button>
        ))}
      </div>

      <ol className="quick-plan__blocks">
        {blocks.map((block, i) => {
          const isLocked = i < played;
          const now = i === currentIdx;
          const prev = previousLineup(i);
          const ins = prev != null ? block.lineup.filter((r) => !prev.includes(r)) : [];
          const invalid = resolveLineup(game, block.lineup) == null;
          const cls = classText(block.lineup);
          const blockExecutions = executions.filter((e) => e.block === i);
          return (
            <li key={`${quarter}-${i}`}>
              <button
                type="button"
                className={
                  isLocked ? 'quick-plan__block quick-plan__block--locked' : 'quick-plan__block'
                }
                disabled={isLocked || !canWrite}
                data-testid={`quick-plan-block-${quarter}-${i}`}
                aria-label={fill(t('quickPlanBlockEditAria'), { n: i + 1, when: whenText(i) })}
                onClick={() => {
                  setNotice(null);
                  setEditIndex(i);
                }}
              >
                <span className="quick-plan__row">
                  <strong className="quick-plan__when">
                    <span className="quick-plan__q">{quarter}</span>
                    {whenText(i)}
                  </strong>
                  <span className="quick-plan__tag">
                    {now
                      ? t('quickPlanBlockNowEdit')
                      : isLocked
                        ? t('quickPlanBlockPlayed')
                        : t('quickPlanBlockEditHint')}
                  </span>
                </span>
                <span className="quick-plan__minis">
                  {block.lineup.map((r) => {
                    const p = byRoster(r);
                    return (
                      <span
                        key={r}
                        className={`quick-plan__mini${ins.includes(r) ? ' quick-plan__mini--in' : ''}${p == null ? ' quick-plan__mini--missing' : ''}`}
                      >
                        <b>{p?.nr ?? '—'}</b>
                        <span>{p?.naam ?? ''}</span>
                      </span>
                    );
                  })}
                </span>
                <span className="quick-plan__diff">
                  {diffText(i, block.lineup)}
                  {cls != null ? ` · ${cls}` : ''}
                  {invalid ? ` · ${t('quickPlanInvalidBlock')}` : ''}
                </span>
                {blockExecutions.map((exec, k) => (
                  <span
                    key={k}
                    className={`quick-plan__actual${exec.same ? '' : ' quick-plan__actual--diff'}`}
                    data-testid={`quick-plan-actual-${quarter}-${i}${k > 0 ? `-${k}` : ''}`}
                  >
                    <span className="quick-plan__minis">
                      {exec.actual.map((r) => {
                        const p = byRoster(r);
                        return (
                          <span
                            key={r}
                            className={`quick-plan__mini${exec.extra.includes(r) ? ' quick-plan__mini--diff' : ''}`}
                          >
                            <b>{p?.nr ?? '—'}</b>
                            <span>{p?.naam ?? ''}</span>
                          </span>
                        );
                      })}
                    </span>
                    <span className="quick-plan__diff">
                      {exec.same
                        ? fill(t('quickPlanActualSame'), { when: actualWhen(exec) })
                        : fill(t('quickPlanActualDiff'), {
                            when: actualWhen(exec),
                            pairs: exec.pairs
                              .map((pair) =>
                                fill(t('quickPlanDeviationPair'), {
                                  actual: label(pair.actual),
                                  planned: pair.planned < 0 ? '?' : label(pair.planned),
                                }),
                              )
                              .join(', '),
                          })}
                    </span>
                  </span>
                ))}
              </button>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        className="btn-outline quick-plan__add"
        disabled={!canWrite}
        data-testid="quick-plan-add-block"
        onClick={handleAdd}
      >
        {t('quickPlanAddBlock')}
      </button>
      {notice != null ? (
        <p className="settings-error" role="alert" data-testid="quick-plan-notice">
          {t(notice)}
        </p>
      ) : null}
      <p className="quick-plan__note">{t('quickPlanHint')}</p>
      <button
        type="button"
        className="btn-outline quick-plan__clear"
        disabled={!canWrite}
        data-testid="quick-plan-clear"
        onClick={() => setConfirm('clear')}
      >
        {t('quickPlanClearBtn')}
      </button>
      {confirmSheet}

      {editIndex != null && editing != null ? (
        <SheetFrame
          title={fill(t('quickPlanEditTitle'), { period, n: quarter, when: whenText(editIndex) })}
          testId="quick-plan-sheet"
          closeLabel={t('quickCloseAria')}
          onClose={closeEditor}
        >
          {editBounds != null ? (
            <>
              <div className="quick-plan__stepper">
                <button
                  type="button"
                  className="btn-outline"
                  disabled={!canEarlier}
                  data-testid="quick-plan-earlier"
                  onClick={() =>
                    onPlanChange(
                      moveBlockTime(plan, quarter, editIndex, earlierDelta, game.clockDown),
                    )
                  }
                >
                  {t('quickNudgeEarlier')}
                </button>
                <strong className="quick-plan__time" data-testid="quick-plan-time">
                  {fmtSec(editing.toSec)}
                </strong>
                <button
                  type="button"
                  className="btn-outline"
                  disabled={!canLater}
                  data-testid="quick-plan-later"
                  onClick={() =>
                    onPlanChange(
                      moveBlockTime(plan, quarter, editIndex, -earlierDelta, game.clockDown),
                    )
                  }
                >
                  {t('quickNudgeLater')}
                </button>
              </div>
              <p className="quick-sheet__meta">{t('quickPlanTimeNote')}</p>
            </>
          ) : (
            <p className="quick-sheet__meta">{t('quickPlanLastBlockNote')}</p>
          )}

          <div className="quick-lineup">
            <div className="quick-grid">
              {editing.lineup.map((r, idx) => {
                const p = byRoster(r);
                const sel = selection?.kind === 'court' && selection.index === idx;
                return (
                  <button
                    key={`${idx}-${r}`}
                    type="button"
                    className={`chip quick-chip${sel ? ' chip--selected' : ''}`}
                    aria-pressed={sel}
                    disabled={lineupLocked}
                    data-testid={`quick-plan-court-${idx}`}
                    onClick={() => tapEditChip({ kind: 'court', index: idx })}
                  >
                    <span className="chip__nr">{p?.nr ?? '—'}</span>
                    <span className="chip__name">{p?.naam ?? t('quickPlanMissingPlayer')}</span>
                  </button>
                );
              })}
            </div>
            <h4 className="quick-lineup__title">{t('benchLabel')}</h4>
            <div className="quick-grid">
              {participants
                .filter((p) => !editing.lineup.includes(p.rosterId))
                .map((p) => {
                  const sel = selection?.kind === 'bench' && selection.rosterId === p.rosterId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`chip quick-chip${sel ? ' chip--selected' : ''}`}
                      aria-pressed={sel}
                      disabled={lineupLocked}
                      data-testid={`quick-plan-bench-${p.rosterId}`}
                      onClick={() => tapEditChip({ kind: 'bench', rosterId: p.rosterId })}
                    >
                      <span className="chip__nr">{p.nr}</span>
                      <span className="chip__name">{p.naam}</span>
                    </button>
                  );
                })}
            </div>
          </div>
          <p className="quick-sheet__meta" data-testid="quick-plan-sheet-note">
            {lineupLocked
              ? t('quickPlanCurrentBlockNote')
              : startersBlock
                ? t('quickPlanStartersNote')
                : t('quickPlanSwapHint')}
          </p>

          <button
            type="button"
            className="btn-primary quick-sheet__confirm"
            data-testid="quick-plan-done"
            onClick={closeEditor}
          >
            {t('quickPlanDoneBtn')}
          </button>
          {blocks.length > 1 && !lineupLocked && editIndex !== currentIdx ? (
            <button
              type="button"
              className="btn-outline"
              data-testid="quick-plan-delete-block"
              onClick={() => {
                onPlanChange(removeBlock(plan, quarter, editIndex));
                closeEditor();
              }}
            >
              {t('quickPlanDeleteBlock')}
            </button>
          ) : null}
        </SheetFrame>
      ) : null}
    </section>
  );
}
