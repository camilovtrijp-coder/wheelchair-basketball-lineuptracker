import { useMemo, useState } from 'preact/hooks';
import type { CompletedGameRepository } from '../../application/game/CompletedGameRepository';
import { buildAnalysisScope } from '../../application/stats/buildAnalysisScope';
import { computeLineupStats } from '../../domain/stats/computeLineupStats';
import { fmtSeconds, fmtPlusMinus, pmClass } from '../../domain/stats/format';
import type { ActiveGame } from '../../domain/game/types';
import type { RosterPlayer } from '../../domain/roster/types';
import type {
  AnalysisGame,
  LineupCombinationStats,
  PlayerFilterEntry,
  PlayerFilterMode,
  StatsFilter,
} from '../../domain/stats/types';
import { translate, type Lang, type StringKey } from '../../i18n/strings';

export interface StatsPanelProps {
  lang: Lang;
  /** PR 6.4 §C.1: canonieke bronnen voor de analyse. De UI leest nooit
   * zelf `localStorage` of Firestore — beide worden via deze props
   * doorgegeven vanuit `app/App.tsx`. */
  repository: CompletedGameRepository;
  activeGame: ActiveGame | null;
  /** Huidige roster (PR 6.3-revisie, aug. 2026: labels voor nog-bestaande
   * spelers komen hiervandaan, niet uit de historische snapshots). */
  roster: RosterPlayer[];
}

const COMBO_SIZES = [1, 2, 3, 4, 5] as const;

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

function localeCode(lang: Lang): string {
  return lang === 'en' ? 'en-GB' : 'nl-NL';
}

function formatDate(iso: string, lang: Lang): string {
  try {
    return new Date(iso).toLocaleDateString(localeCode(lang));
  } catch {
    return '';
  }
}

/** V1: `playerById()`-vervanging — actuele rosterId → label. Voor
 * historische spelers die niet meer in de huidige roster voorkomen valt
 * deze terug op de snapshot-info in `AnalysisGame.players`. */
function labelFor(rosterId: number, games: AnalysisGame[], currentRoster: RosterPlayer[]): string {
  const fromCurrent = currentRoster.find((p) => p.id === rosterId);
  if (fromCurrent) return `#${fromCurrent.nr} ${fromCurrent.naam}`;
  // Plan §C.2: actuele roster eerst, anders nieuwste historische snapshot,
  // anders "#?" als veilige fallback.
  for (let i = 0; i < games.length; i += 1) {
    const g = games[i]!;
    const player = g.players.find((p) => p.rosterId === rosterId);
    if (player) return `#${player.nr} ${player.naam}`;
  }
  return '#?';
}

export function StatsPanel({ lang, repository, activeGame, roster }: StatsPanelProps) {
  const scope = useMemo(() => buildAnalysisScope(repository, activeGame), [repository, activeGame]);
  const [comboSize, setComboSize] = useState<1 | 2 | 3 | 4 | 5>(5);
  const [per10, setPer10] = useState(false);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [gameIds, setGameIds] = useState<Set<string> | null>(null);
  const [playerFilters, setPlayerFilters] = useState<PlayerFilterEntry[]>([]);
  const [gamesModalOpen, setGamesModalOpen] = useState(false);
  const [filterModalOpen, setFilterModalOpen] = useState(false);

  const filter: StatsFilter = useMemo(
    () => ({ comboSize, per10, sortDirection, gameIds, playerFilters }),
    [comboSize, per10, sortDirection, gameIds, playerFilters],
  );

  const result = useMemo(() => computeLineupStats(scope.games, filter), [scope.games, filter]);

  const { status } = scope.historyRead;
  const showError = status === 'error';
  const showNoData = !showError && scope.games.length === 0;
  const showNoCombos = !showError && scope.games.length > 0 && result.combinations.length === 0;

  return (
    <section className="stats-panel" aria-label={t(lang, 'statsTitle')}>
      <h2>{t(lang, 'statsTitle')}</h2>
      {showError ? (
        <p className="stats-empty stats-empty--error" data-testid="stats-read-error" role="alert">
          {t(lang, 'statsReadError')}
        </p>
      ) : null}

      <div className="stats-controls">
        <div
          className="stats-controls__row"
          role="group"
          aria-label={t(lang, 'statsComboSizeLabel')}
        >
          {COMBO_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              className={`quarter-btn${comboSize === n ? ' quarter-btn--active' : ''}`}
              data-testid={`stats-combo-size-${n}`}
              onClick={() => setComboSize(n)}
              aria-pressed={comboSize === n}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="stats-controls__row stats-controls__row--wrap">
          <button
            type="button"
            className="btn-outline"
            data-testid="stats-sort-toggle"
            onClick={() => setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc')}
          >
            {sortDirection === 'desc'
              ? t(lang, 'statsSortToggleDesc')
              : t(lang, 'statsSortToggleAsc')}
          </button>
          <button
            type="button"
            className={`btn-outline${per10 ? ' stats-toggle--active' : ''}`}
            data-testid="stats-per10-toggle"
            onClick={() => setPer10(!per10)}
            aria-pressed={per10}
          >
            {t(lang, 'statsPer10')}
          </button>
          <button
            type="button"
            className="btn-outline"
            data-testid="stats-games-btn"
            onClick={() => setGamesModalOpen(true)}
          >
            {t(lang, 'statsGamesBtn')} ({gameIds === null ? scope.games.length : gameIds.size})
          </button>
          <button
            type="button"
            className="btn-outline"
            data-testid="stats-filter-btn"
            onClick={() => setFilterModalOpen(true)}
          >
            {t(lang, 'statsFilterBtn')}
            {playerFilters.length > 0 ? ` (${playerFilters.length})` : ''}
          </button>
        </div>
      </div>

      {showNoData ? (
        <p className="stats-empty" data-testid="stats-no-data">
          {t(lang, 'statsNoData')}
        </p>
      ) : showNoCombos ? (
        <p className="stats-empty" data-testid="stats-no-combos">
          {t(lang, 'statsNoCombos')}
        </p>
      ) : showError ? null : (
        <div className="stats-list" data-testid="stats-list">
          {result.combinations.map((combo) => (
            <ComboCard
              key={combo.rosterIds.join(',')}
              combo={combo}
              per10={per10}
              games={scope.games}
              currentRoster={roster}
              lang={lang}
            />
          ))}
        </div>
      )}

      {gamesModalOpen ? (
        <GamesModal
          lang={lang}
          scope={scope.games}
          selected={gameIds}
          onClose={() => setGamesModalOpen(false)}
          onToggle={(id) => {
            setGameIds((prev) =>
              toggleIdInSet(
                prev,
                id,
                scope.games.map((g) => g.id),
              ),
            );
          }}
          onClear={() => setGameIds(new Set())}
        />
      ) : null}

      {filterModalOpen ? (
        <PlayerFilterModal
          lang={lang}
          scope={scope.games}
          currentRoster={roster}
          filters={playerFilters}
          onClose={() => setFilterModalOpen(false)}
          onCycle={(rosterId) => {
            setPlayerFilters((prev) => cyclePlayerFilter(prev, rosterId));
          }}
          onClear={() => setPlayerFilters([])}
        />
      ) : null}
    </section>
  );
}

function toggleIdInSet(prev: Set<string> | null, id: string, allIds: string[]): Set<string> | null {
  // null = "alles aanwezig" (v1: `statsGameIds == null`). Bij de eerste
  // toggle materialiseren we een Set die álles bevat; daarna gedraagt
  // de Set zich als de canonieke selectie. Wanneer alle id's opnieuw
  // geselecteerd zijn, normaliseren we terug naar null zodat de UI
  // consistent blijft met v1.
  const next = prev === null ? new Set(allIds) : new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next.size === allIds.length ? null : next;
}

function cyclePlayerFilter(prev: PlayerFilterEntry[], rosterId: number): PlayerFilterEntry[] {
  const idx = prev.findIndex((e) => e.rosterId === rosterId);
  const nextMode: PlayerFilterMode =
    idx < 0 ? 'on' : prev[idx]!.mode === 'on' ? 'off' : prev[idx]!.mode === 'off' ? 'none' : 'on';
  if (nextMode === 'none') {
    return prev.filter((_, i) => i !== idx);
  }
  if (idx < 0) {
    return [...prev, { rosterId, mode: nextMode }];
  }
  const copy = prev.slice();
  copy[idx] = { rosterId, mode: nextMode };
  return copy;
}

function ComboCard({
  combo,
  per10,
  games,
  currentRoster,
  lang,
}: {
  combo: LineupCombinationStats;
  per10: boolean;
  games: AnalysisGame[];
  currentRoster: RosterPlayer[];
  lang: Lang;
}) {
  const onPMRaw = combo.onPF - combo.onPA;
  const offPMRaw = combo.offPF - combo.offPA;
  const onShown = per10 && combo.onSec > 0 ? (onPMRaw * 600) / combo.onSec : onPMRaw;
  const offShown = per10 && combo.offSec > 0 ? (offPMRaw * 600) / combo.offSec : offPMRaw;
  const names = combo.rosterIds.map((id) => labelFor(id, games, currentRoster));
  return (
    <div className="card stats-card" data-testid={`stats-combo-${combo.rosterIds.join('-')}`}>
      <div className="stats-card__lineup">
        {names.map((n, i) => (
          <div key={i}>{n}</div>
        ))}
      </div>
      <div className="statsgrid stats-card__grid">
        <Stat label={t(lang, 'statsColTime')} value={fmtSeconds(combo.onSec)} />
        <Stat label={t(lang, 'statsColPts')} value={String(combo.onPF)} tone="pos" />
        <Stat label={t(lang, 'statsColOpp')} value={String(combo.onPA)} tone="neg" />
        <Stat
          label={t(lang, 'statsColOn')}
          value={fmtPlusMinus(onShown)}
          tone={pmClass(onShown)}
          badge
        />
        <Stat
          label={t(lang, 'statsColOff')}
          value={fmtPlusMinus(offShown)}
          tone={pmClass(offShown)}
          badge
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  badge,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg' | 'flat';
  badge?: boolean;
}) {
  return (
    <div>
      <div className="mut2">{label}</div>
      {badge ? (
        <span
          className={`badge-pm live-pm--${tone === 'pos' ? 'pos' : tone === 'neg' ? 'neg' : 'flat'}`}
          data-num={tone}
        >
          {value}
        </span>
      ) : (
        <div
          className={`v stats-stat__v--${tone === 'pos' ? 'pos' : tone === 'neg' ? 'neg' : 'flat'}`}
        >
          {value}
        </div>
      )}
    </div>
  );
}

/** PR 6.4: modale filter. v1 gebruikte een inline-`onclick`-attribuut op
 * een `<div>` voor de backdrop-stop-propagation. Hier vangen we de
 * backdrop-click op het dialoog-element zelf op en laten we de binnenste
 * `.modal` de propagation stoppen — patroon dat eslint-plugin-jsx-a11y
 * toestaat zolang het dialoog-element `role="dialog"` + `aria-modal`
 * draagt en keyboard-afhandeling heeft (Escape om te sluiten). */
function GamesModal({
  lang,
  scope,
  selected,
  onClose,
  onToggle,
  onClear,
}: {
  lang: Lang;
  scope: AnalysisGame[];
  selected: Set<string> | null;
  onClose: () => void;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <ModalDialog
      title={t(lang, 'statsGamesTitle')}
      onClose={onClose}
      testId="stats-games-modal"
      clearLabel={t(lang, 'statsClearBtn')}
      doneLabel={t(lang, 'statsDoneBtn')}
      onClear={onClear}
    >
      {scope.length === 0 ? (
        <p className="modal__desc">{t(lang, 'statsNoData')}</p>
      ) : (
        scope.map((g) => {
          const on = selected === null || selected.has(g.id);
          return (
            <label key={g.id} className="stats-modal-row" data-testid={`stats-game-row-${g.id}`}>
              <span className="stats-modal-row__label">
                {g.isCurrent ? t(lang, 'statsCurrentGame') : g.opponent || t(lang, 'teamOpponent')}
                <span className="mut2 xs">
                  {formatDate(g.date, lang)}
                  {g.competition ? ` · ${g.competition}` : ''}
                </span>
              </span>
              <input
                type="checkbox"
                checked={on}
                data-testid={`stats-game-check-${g.id}`}
                onChange={() => onToggle(g.id)}
                style={{ width: '1.1rem', height: '1.1rem', flex: 'none' }}
              />
            </label>
          );
        })
      )}
    </ModalDialog>
  );
}

function PlayerFilterModal({
  lang,
  scope,
  currentRoster,
  filters,
  onClose,
  onCycle,
  onClear,
}: {
  lang: Lang;
  scope: AnalysisGame[];
  currentRoster: RosterPlayer[];
  filters: PlayerFilterEntry[];
  onClose: () => void;
  onCycle: (rosterId: number) => void;
  onClear: () => void;
}) {
  // Verzamel unieke rosterIds uit de huidige roster en aanvullend uit de
  // historische spelers (zodat ook verwijderde spelers nog filterbaar
  // blijven — plan §C.2 "actuele rostergegevens indien de speler nog
  // bestaat, anders de nieuwste bruikbare historische spelersnapshot").
  const seen = new Set<number>();
  const options: { rosterId: number; label: string }[] = [];
  for (const p of currentRoster) {
    if (typeof p.id !== 'number') continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    options.push({ rosterId: p.id, label: `#${p.nr} ${p.naam}` });
  }
  for (const g of scope) {
    for (const p of g.players) {
      if (seen.has(p.rosterId)) continue;
      seen.add(p.rosterId);
      options.push({ rosterId: p.rosterId, label: `#${p.nr} ${p.naam}` });
    }
  }

  return (
    <ModalDialog
      title={t(lang, 'statsFilterTitle')}
      onClose={onClose}
      testId="stats-filter-modal"
      clearLabel={t(lang, 'statsClearBtn')}
      doneLabel={t(lang, 'statsDoneBtn')}
      onClear={onClear}
      description={t(lang, 'statsFilterHint')}
    >
      {options.length === 0 ? (
        <p className="modal__desc">{t(lang, 'statsNoData')}</p>
      ) : (
        options.map((o) => {
          const v = filters.find((f) => f.rosterId === o.rosterId)?.mode ?? 'none';
          const symbol = v === 'on' ? '✓' : v === 'off' ? '✗' : '—';
          const cls = v === 'on' ? 'stats-toggle--on-st' : v === 'off' ? 'stats-toggle--on-v' : '';
          return (
            <div
              key={o.rosterId}
              className="stats-modal-row"
              data-testid={`stats-filter-row-${o.rosterId}`}
            >
              <span className="stats-modal-row__label">{o.label}</span>
              <button
                type="button"
                className={`toggle-btn${cls ? ' ' + cls : ''}`}
                data-testid={`stats-filter-toggle-${o.rosterId}`}
                data-state={v}
                onClick={() => onCycle(o.rosterId)}
                aria-label={`${o.label} ${v}`}
              >
                {symbol}
              </button>
            </div>
          );
        })
      )}
    </ModalDialog>
  );
}

/**
 * Modal-dialoogpatroon dat voldoet aan jsx-a11y: de backdrop-click sluit
 * het venal (`role="dialog"` met `aria-modal` en keyboard handler), terwijl
 * de binnenste `.modal` de click-propagation stopt zodat interacties
 * binnen het venal de backdrop niet sluiten. De click-stop op de inner
 * div is geaccepteerd omdat hij uitsluitend dient om de
 * backdrop-click-stop-propagation van de buitenste div te isoleren — geen
 * eigen interactie of functionaliteit.
 */
function ModalDialog({
  title,
  description,
  onClose,
  onClear,
  clearLabel,
  doneLabel,
  testId,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  onClear?: () => void;
  clearLabel: string;
  doneLabel: string;
  testId: string;
  children: preact.ComponentChildren;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="modal-overlay"
      role="dialog"
      aria-label={title}
      aria-modal="true"
      data-testid={testId}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <div className="modal" role="document" onClick={(e) => e.stopPropagation()}>
        <div className="modal__title-row">
          {onClear ? (
            <button
              type="button"
              className="btn-outline"
              data-testid={`${testId}-clear`}
              onClick={onClear}
            >
              {clearLabel}
            </button>
          ) : (
            <span />
          )}
          <h2>{title}</h2>
          <button
            type="button"
            className="btn-outline"
            data-testid={`${testId}-done`}
            onClick={onClose}
          >
            {doneLabel}
          </button>
        </div>
        {description ? <p className="modal__desc">{description}</p> : null}
        {children}
      </div>
    </div>
  );
}
