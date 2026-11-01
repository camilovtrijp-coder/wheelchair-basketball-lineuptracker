import type { ActiveGame, Segment } from '../../domain/game/types';
import { segmentScoreBounds } from '../../domain/game/liveCommands';
import { deriveGameHistory, segmentTurnovers } from '../../domain/game/tracking';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { fmtSec } from './liveFormat';

/**
 * Inklapbaar segmentoverzicht van het compacte scherm (bouwplan C3). Begin- en
 * eindstand zijn niet opgeslagen maar afgeleid (`segmentScoreBounds`). De knop
 * Bewerken staat op dezelfde kopregel als kwart en tijden; de kopregel loopt op
 * zeer smalle schermen om (flex-wrap).
 */
export interface CompactSegmentListProps {
  lang: Lang;
  game: ActiveGame;
  periodLabel: string;
  expanded: boolean;
  canWrite: boolean;
  /** Uitwedstrijd: alleen de weergavevolgorde van de standen (tegenstander links). */
  away?: boolean;
  onToggle: () => void;
  onEdit: (segmentId: string) => void;
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}

export function playerText(game: ActiveGame, id: string): string {
  const p = game.players.find((pl) => pl.id === id);
  return p ? `#${p.nr} ${p.naam}` : '#?';
}

export function CompactSegmentList({
  lang,
  game,
  periodLabel,
  expanded,
  canWrite,
  away = false,
  onToggle,
  onEdit,
}: CompactSegmentListProps) {
  const t = (key: StringKey) => translate(lang, key);
  const segments: Segment[] = deriveGameHistory(game).segments;
  const bounds = segmentScoreBounds(segments);
  const period = periodLabel || t('quarterLabel');
  const pair = (own: number, opp: number) => (away ? `${opp}–${own}` : `${own}–${opp}`);
  return (
    <div className="compact-segments" data-testid="compact-segments">
      <button
        type="button"
        className="compact-segments__toggle"
        aria-expanded={expanded}
        aria-controls="compact-segments-body"
        data-testid="compact-segments-toggle"
        onClick={onToggle}
      >
        <span>
          {t('compactSegmentsTitle')} ({segments.length})
        </span>
        <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded ? (
        <div id="compact-segments-body" data-testid="compact-segments-body">
          {segments.length === 0 ? (
            <p className="compact-panel__note" data-testid="compact-segments-empty">
              {t('compactSegmentsEmpty')}
            </p>
          ) : (
            <ol className="compact-segments__list">
              {segments.map((s, i) => {
                const b = bounds[i]!;
                const pm = s.pf - s.pa;
                const begin = fmtSec(s.beginSec);
                const end = fmtSec(s.endSec);
                return (
                  <li key={s.id} className="compact-seg" data-testid={`compact-segment-${s.id}`}>
                    <div className="compact-seg__head">
                      <strong
                        className="compact-seg__when"
                        data-testid={`compact-segment-when-${s.id}`}
                      >
                        {period} {s.quarter} · {begin} → {end}
                      </strong>
                      <button
                        type="button"
                        className="btn-outline compact-seg__edit"
                        disabled={!canWrite}
                        data-testid={`compact-segment-edit-${s.id}`}
                        aria-label={t('compactSegmentEditAria')
                          .replace('{n}', String(i + 1))
                          .replace('{period}', period)
                          .replace('{quarter}', String(s.quarter))
                          .replace('{begin}', begin)
                          .replace('{end}', end)}
                        onClick={() => canWrite && onEdit(s.id)}
                      >
                        {t('compactSegmentEditBtn')}
                      </button>
                      <span
                        className="compact-seg__dur"
                        data-testid={`compact-segment-dur-${s.id}`}
                      >
                        {fmtSec(s.durSec)}
                      </span>
                    </div>
                    <p
                      className="compact-seg__lineup"
                      data-testid={`compact-segment-lineup-${s.id}`}
                    >
                      {s.over ? (
                        <span
                          title={t('compactSegOverLimit')}
                          aria-label={t('compactSegOverLimit')}
                        >
                          ⚠{' '}
                        </span>
                      ) : null}
                      {s.lineup.map((id) => playerText(game, id)).join(' · ')}
                    </p>
                    <p className="compact-seg__stats" data-testid={`compact-segment-stats-${s.id}`}>
                      <span>
                        {t('compactSegScoreLabel')} {pair(b.beginFor, b.beginAgainst)} →{' '}
                        {pair(b.endFor, b.endAgainst)}
                      </span>
                      <span>
                        {t('compactSegPointsLabel')} {pair(s.pf, s.pa)}
                      </span>
                      <span>
                        {t('compactSegPmLabel')}{' '}
                        <strong className={pm > 0 ? 'live-pm--pos' : pm < 0 ? 'live-pm--neg' : ''}>
                          {signed(pm)}
                        </strong>
                      </span>
                      <span>
                        {t('turnoverPillPrefix')} {segmentTurnovers(s)}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}
