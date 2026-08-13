import type { CompletedGame } from '../../domain/game/types';
import { combinedCsvForGame, csvFilenameFor } from '../../domain/game/csv';
import { shareOrDownloadCsv } from '../../infrastructure/game/shareOrDownloadCsv';
import { translate, type Lang, type StringKey } from '../../i18n/strings';

export interface HistoryPanelProps {
  lang: Lang;
  games: CompletedGame[];
  teamName: string;
  /** Gecontroleerd door de aanroeper (v1: module-level `historyOpenId`), zodat
   * "Afronden" direct de net afgeronde wedstrijd kan openen (v1-pariteit). */
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  onDeleteGame: (id: string) => void;
  canWrite: boolean;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

function localeCode(lang: Lang): string {
  return lang === 'en' ? 'en-GB' : 'nl-NL';
}

/** v1: `gameDateLabel()`. */
function gameDateLabel(game: CompletedGame, lang: Lang): string {
  try {
    return new Date(game.date).toLocaleDateString(localeCode(lang));
  } catch {
    return '';
  }
}

/** v1: `fmt()`. */
function fmtSec(sec: number): string {
  const neg = sec < 0;
  const abs = Math.abs(sec);
  return `${neg ? '-' : ''}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

const pmColor = (n: number): string =>
  n > 0 ? 'live-pm--pos' : n < 0 ? 'live-pm--neg' : 'live-pm--flat';

export function HistoryPanel({
  lang,
  games,
  teamName,
  openId,
  onOpenChange,
  onDeleteGame,
  canWrite,
}: HistoryPanelProps) {
  const open = openId != null ? games.find((g) => g.id === openId) : undefined;

  if (open) {
    const byId = new Map(open.players.map((p) => [p.id, p]));
    return (
      <section className="history-panel" aria-label={t(lang, 'historyTitle')}>
        <div className="history-detail__actions">
          <button
            type="button"
            className="btn-outline"
            data-testid="history-back-btn"
            onClick={() => onOpenChange(null)}
          >
            ← {t(lang, 'backBtn')}
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={!canWrite}
            data-testid="history-delete-btn"
            onClick={() => {
              if (!window.confirm(t(lang, 'confirmDeleteGame'))) return;
              onDeleteGame(open.id);
            }}
          >
            {t(lang, 'deleteBtn')}
          </button>
        </div>
        <h2>{open.opponent || t(lang, 'teamOpponent')}</h2>
        <p className="history-detail__meta">
          {gameDateLabel(open, lang)}
          {open.competition ? ` · ${open.competition}` : ''} · {open.scoreFor} - {open.scoreAgainst}
        </p>
        <div className="segment-list">
          {open.segments.map((s) => {
            const pm = s.pf - s.pa;
            const nrs = s.lineup.map((id) => byId.get(id)?.nr ?? '?').join('-');
            return (
              <div key={s.id} className="segment-item" data-testid={`history-segment-${s.id}`}>
                <span className="segment-item__lineup">
                  <span className="segment-item__quarter">Q{s.quarter}</span> {nrs}
                </span>
                <span className="segment-item__stats">
                  <span>{fmtSec(s.durSec)}</span>
                  <span className={pmColor(pm)}>
                    {pm >= 0 ? '+' : ''}
                    {pm}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="btn-primary history-detail__export"
          data-testid="history-export-btn"
          onClick={() =>
            shareOrDownloadCsv(
              combinedCsvForGame(open),
              csvFilenameFor(open),
              `${teamName || t(lang, 'appNameFallback')} export`,
            )
          }
        >
          {t(lang, 'exportShareBtn')}
        </button>
      </section>
    );
  }

  return (
    <section className="history-panel" aria-label={t(lang, 'historyTitle')}>
      {games.length === 0 ? (
        <p className="history-empty" data-testid="history-empty">
          {t(lang, 'historyEmpty')}
        </p>
      ) : (
        <div className="history-list" data-testid="history-list">
          {games.map((g) => {
            const pm = g.scoreFor - g.scoreAgainst;
            return (
              <button
                type="button"
                key={g.id}
                className="history-item"
                data-testid={`history-item-${g.id}`}
                onClick={() => onOpenChange(g.id)}
              >
                <span className="history-item__meta">
                  <span className="history-item__opponent">
                    {g.opponent || t(lang, 'teamOpponent')}
                  </span>
                  <span className="history-item__date">
                    {gameDateLabel(g, lang)}
                    {g.competition ? ` · ${g.competition}` : ''}
                  </span>
                </span>
                <span className={`history-item__score ${pmColor(pm)}`}>
                  {g.scoreFor} - {g.scoreAgainst}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
