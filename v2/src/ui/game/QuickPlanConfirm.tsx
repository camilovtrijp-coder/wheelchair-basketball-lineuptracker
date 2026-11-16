import type { ComponentChildren } from 'preact';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import type { PlanChange } from '../../domain/game/rotationPlan';
import { fmtSec } from './LiveTrackingPanel';
import { SheetFrame } from './QuickSheets';

/**
 * Bevestigingsstap van het Wisselschema (Schema wissen, Zelfde als vorige wedstrijd,
 * Rest van het schema aanpassen). Inline in het scherm als Snel-sheet, nooit
 * `window.confirm`. Tonen en bevestigen zijn puur UI; de wijziging zelf doet de aanroeper.
 */
export interface QuickPlanConfirmSheetProps {
  lang: Lang;
  title: string;
  testId: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ComponentChildren;
}

export function QuickPlanConfirmSheet({
  lang,
  title,
  testId,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  children,
}: QuickPlanConfirmSheetProps) {
  const t = (key: StringKey) => translate(lang, key);
  return (
    <SheetFrame title={title} testId={testId} closeLabel={t('quickCloseAria')} onClose={onCancel}>
      {children}
      <button
        type="button"
        className={danger ? 'btn-danger quick-sheet__confirm' : 'btn-primary quick-sheet__confirm'}
        data-testid={`${testId}-confirm`}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        className="btn-outline"
        data-testid={`${testId}-cancel`}
        onClick={onCancel}
      >
        {t('cancelBtn')}
      </button>
    </SheetFrame>
  );
}

const MAX_LINES = 8;

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

export interface QuickPlanChangeListProps {
  lang: Lang;
  changes: PlanChange[];
  period: string;
  /** Naam van een `rosterId`. */
  label: (rosterId: number) => string;
}

/** Kort overzicht van wat er in het schema verandert (maximaal 8 regels, rest als telling). */
export function QuickPlanChangeList({ lang, changes, period, label }: QuickPlanChangeListProps) {
  const t = (key: StringKey) => translate(lang, key);
  if (changes.length === 0) {
    return (
      <p className="quick-sheet__meta" data-testid="quick-plan-changes-none">
        {t('quickPlanChangesNone')}
      </p>
    );
  }
  const shown = changes.slice(0, MAX_LINES);
  const names = (ids: number[]) => ids.map(label).join(', ');
  function line(change: PlanChange): string {
    const where = fill(t('quickPlanChangeWhere'), {
      period,
      n: change.quarter,
      block: change.block + 1,
    });
    switch (change.kind) {
      case 'lineup':
        return `${where}: ${fill(t('quickPlanInOut'), { ins: names(change.ins), outs: names(change.outs) })}`;
      case 'time':
        return `${where}: ${fill(t('quickPlanChangeTime'), { from: fmtSec(change.fromSec), to: fmtSec(change.toSec) })}`;
      case 'added':
        return `${where}: ${t('quickPlanChangeAdded')}`;
      default:
        return `${where}: ${t('quickPlanChangeRemoved')}`;
    }
  }
  return (
    <>
      <ul className="quick-plan__changes" data-testid="quick-plan-changes">
        {shown.map((change, k) => (
          <li key={k}>{line(change)}</li>
        ))}
      </ul>
      {changes.length > shown.length ? (
        <p className="quick-sheet__meta">
          {fill(t('quickPlanChangesMore'), { n: changes.length - shown.length })}
        </p>
      ) : null}
    </>
  );
}
