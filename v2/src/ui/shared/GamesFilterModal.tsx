import type { AnalysisGame } from '../../domain/stats/types';
import { translate, type Lang } from '../../i18n/strings';
import { ModalDialog } from './ModalDialog';

/**
 * PR 6.5 §C.2/§F — het wedstrijdfilter is identiek voor Stats en Trends
 * (docs/pr-6.5-plan.md): dezelfde `Set<AnalysisGame.id> | null`-selectie,
 * hier als gedeeld UI-component zodat er geen tweede, afwijkende
 * implementatie ontstaat (plan §F). Was tot PR 6.5 een lokaal `GamesModal`
 * in `ui/stats/StatsPanel.tsx`; nu verplaatst naar `ui/shared` en door beide
 * tabs gebruikt. De eigenaar van de `Set`-state blijft `app/App.tsx` (plan
 * §D 6.5b: "De selectie-ID's blijven in een gedeelde state boven Stats en
 * Trends").
 */

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

export function toggleGameIdInSet(
  prev: Set<string> | null,
  id: string,
  allIds: string[],
): Set<string> | null {
  // null = "alles aanwezig" (v1: `statsGameIds == null`). Bij de eerste
  // toggle materialiseren we een Set die álles bevat; daarna gedraagt de Set
  // zich als de canonieke selectie. Wanneer alle id's opnieuw geselecteerd
  // zijn, normaliseren we terug naar null zodat de UI consistent blijft met v1.
  const next = prev === null ? new Set(allIds) : new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next.size === allIds.length ? null : next;
}

export function GamesFilterModal({
  lang,
  scope,
  selected,
  onClose,
  onToggle,
  onClear,
  /**
   * `data-testid`'s. Standaard identiek aan het vóór PR 6.5 lokale
   * `GamesModal` in `StatsPanel.tsx` (`stats-games-modal` /
   * `stats-game-row-*` / `stats-game-check-*`) zodat de bestaande
   * Playwright-suite ongewijzigd blijft werken. Trends geeft eigen
   * voorvoegsels mee.
   */
  modalTestId = 'stats-games-modal',
  rowTestIdPrefix = 'stats-game-row',
  checkTestIdPrefix = 'stats-game-check',
}: {
  lang: Lang;
  scope: AnalysisGame[];
  selected: Set<string> | null;
  onClose: () => void;
  onToggle: (id: string) => void;
  onClear: () => void;
  modalTestId?: string;
  rowTestIdPrefix?: string;
  checkTestIdPrefix?: string;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  return (
    <ModalDialog
      title={t('statsGamesTitle')}
      onClose={onClose}
      testId={modalTestId}
      clearLabel={t('statsClearBtn')}
      doneLabel={t('statsDoneBtn')}
      onClear={onClear}
    >
      {scope.length === 0 ? (
        <p className="modal__desc">{t('statsNoData')}</p>
      ) : (
        scope.map((g) => {
          const on = selected === null || selected.has(g.id);
          return (
            <label
              key={g.id}
              className="stats-modal-row"
              data-testid={`${rowTestIdPrefix}-${g.id}`}
            >
              <span className="stats-modal-row__label">
                {g.isCurrent ? t('statsCurrentGame') : g.opponent || t('teamOpponent')}
                <span className="mut2 xs">
                  {formatDate(g.date, lang)}
                  {g.competition ? ` · ${g.competition}` : ''}
                </span>
              </span>
              <input
                type="checkbox"
                checked={on}
                data-testid={`${checkTestIdPrefix}-${g.id}`}
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
