import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { ActiveGame, Segment } from '../../domain/game/types';
import type { ClassificationConfig } from '../../domain/game/tracking';
import {
  commitRetroactiveSwap,
  proposeSwapTime,
  retroSwapEntries,
  type SwapFlowError,
} from '../../domain/game/swapFlow';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { fmtSec, liveErrorKey } from './liveFormat';
import { SheetFrame } from './QuickSheets';
import { CalmClockField } from './CalmClockField';

/**
 * Onderbladen van het Rustig-scherm: wissel met terugwerkende kracht en de
 * bevestiging van open wisseltijden vóór Einde kwart. Alles hier is UI-state;
 * de `ActiveGame` verandert via één `onCommit(next, info)` met het resultaat van
 * een `swapFlow`-commando op de LAATSTE game-state.
 */

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}

export function swapErrorKey(error: SwapFlowError): StringKey | null {
  if (error === 'nothing-to-undo') return 'calmErrorNothingToUndo';
  if (error === 'invalid-split') return 'calmErrorInvalidSplit';
  return liveErrorKey(error);
}

// ---------- wissel met terugwerkende kracht ----------

export interface CalmRetroSheetProps {
  lang: Lang;
  game: ActiveGame;
  classification: ClassificationConfig;
  teamName: string;
  onCommit: (
    next: ActiveGame,
    info: { segmentId: string; lastActionId: string; endSec: number },
  ) => void;
  onClose: () => void;
}

export function CalmRetroSheet({
  lang,
  game,
  classification,
  teamName,
  onCommit,
  onClose,
}: CalmRetroSheetProps) {
  const t = (key: StringKey) => translate(lang, key);
  const entries = retroSwapEntries(game);
  const [endSec, setEndSec] = useState<number | null>(() => proposeSwapTime(game, null).endSec);
  // `undefined` = nog geen grens gekozen; `null` = niets hoort bij de oude vijf.
  const [boundary, setBoundary] = useState<string | null | undefined>(
    entries != null && entries.length === 0 ? null : undefined,
  );
  const [error, setError] = useState<SwapFlowError | null>(null);

  const ownName = teamName || t('teamFallbackLabel');
  const opponentName = t('teamOpponent');
  const bounds = game.clockDown
    ? { min: 0, max: game.beginSec - 1 }
    : { min: game.beginSec + 1, max: 600 };
  const canConfirm =
    game.pendingSwapLineup != null && entries != null && endSec != null && boundary !== undefined;

  function handleConfirm() {
    if (!canConfirm || endSec == null || boundary === undefined) return;
    const result = commitRetroactiveSwap(game, {
      endSec,
      lastOldActionId: boundary,
      classification,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCommit(result.game, {
      segmentId: result.segmentId,
      lastActionId: result.lastActionId,
      endSec,
    });
    onClose();
  }

  const errorKey = error != null ? swapErrorKey(error) : null;
  const dividerAfter = (id: string | null) =>
    boundary === id ? (
      <li className="calm-retro__divider" aria-hidden="true">
        {t('calmRetroDivider')}
      </li>
    ) : null;

  return (
    <SheetFrame
      title={t('calmRetroTitle')}
      testId="calm-retro-sheet"
      closeLabel={t('calmCloseAria')}
      onClose={onClose}
    >
      {game.pendingSwapLineup == null ? (
        <p className="quick-sheet__meta" data-testid="calm-retro-noswap">
          {t('calmRetroNoSwap')}
        </p>
      ) : entries == null ? (
        <p className="settings-error" role="alert" data-testid="calm-retro-unavailable">
          {t('calmRetroUnavailable')}
        </p>
      ) : (
        <>
          <p className="quick-sheet__meta">{t('calmRetroTimeLabel')}</p>
          <CalmClockField
            lang={lang}
            value={endSec}
            clockDown={game.clockDown}
            bounds={bounds}
            testId="calm-retro-time"
            onChange={(next) => {
              setEndSec(next);
              setError(null);
            }}
          />
          {entries.length > 0 ? (
            <>
              <p className="quick-sheet__meta">{t('calmRetroListLabel')}</p>
              <ol className="calm-retro__list" data-testid="calm-retro-list">
                <li>
                  <button
                    type="button"
                    className={
                      boundary === null ? 'calm-retro__row calm-retro__row--on' : 'calm-retro__row'
                    }
                    aria-pressed={boundary === null}
                    data-testid="calm-retro-none"
                    onClick={() => {
                      setBoundary(null);
                      setError(null);
                    }}
                  >
                    {t('calmRetroNone')}
                  </button>
                </li>
                {dividerAfter(null)}
                {entries.map((entry) => (
                  <Fragment key={entry.actionId}>
                    <li>
                      <button
                        type="button"
                        className={
                          boundary === entry.actionId
                            ? 'calm-retro__row calm-retro__row--on'
                            : 'calm-retro__row'
                        }
                        aria-pressed={boundary === entry.actionId}
                        data-testid={`calm-retro-entry-${entry.actionId}`}
                        onClick={() => {
                          setBoundary(entry.actionId);
                          setError(null);
                        }}
                      >
                        {entry.kind === 'score'
                          ? fill(t('calmRetroEntryScore'), {
                              points: signed(entry.delta),
                              team: entry.team === 'for' ? ownName : opponentName,
                            })
                          : fill(t('calmRetroEntryTurnover'), { delta: signed(entry.delta) })}
                      </button>
                    </li>
                    {dividerAfter(entry.actionId)}
                  </Fragment>
                ))}
              </ol>
            </>
          ) : null}
        </>
      )}
      {errorKey != null ? (
        <p className="settings-error" role="alert" data-testid="calm-retro-error">
          {fill(t(errorKey), { start: '' })}
        </p>
      ) : null}
      <button
        type="button"
        className="btn-primary quick-sheet__confirm"
        disabled={!canConfirm}
        data-testid="calm-retro-confirm"
        onClick={handleConfirm}
      >
        {t('calmRetroConfirm')}
      </button>
    </SheetFrame>
  );
}

// ---------- open tijden vóór Einde kwart ----------

export interface CalmConfirmSheetProps {
  lang: Lang;
  /** Open schattingen, oudste eerst. */
  segments: Segment[];
  onConfirmAll: () => void;
  onAdjust: (segmentId: string) => void;
  onClose: () => void;
}

export function CalmConfirmSheet({
  lang,
  segments,
  onConfirmAll,
  onAdjust,
  onClose,
}: CalmConfirmSheetProps) {
  const t = (key: StringKey) => translate(lang, key);
  return (
    <SheetFrame
      title={t('calmConfirmTitle')}
      testId="calm-confirm-sheet"
      closeLabel={t('calmCloseAria')}
      onClose={onClose}
    >
      <p className="quick-sheet__meta">{t('calmConfirmBody')}</p>
      <ul className="calm-confirm__list" data-testid="calm-confirm-list">
        {segments.map((s) => (
          <li key={s.id} className="calm-confirm__row" data-testid={`calm-confirm-row-${s.id}`}>
            <span>{fill(t('calmConfirmRow'), { time: fmtSec(s.endSec) })}</span>
            <button
              type="button"
              className="btn-outline"
              data-testid={`calm-confirm-adjust-${s.id}`}
              onClick={() => onAdjust(s.id)}
            >
              {t('calmConfirmAdjust')}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn-primary quick-sheet__confirm"
        data-testid="calm-confirm-all"
        onClick={onConfirmAll}
      >
        {t('calmConfirmAll')}
      </button>
    </SheetFrame>
  );
}
