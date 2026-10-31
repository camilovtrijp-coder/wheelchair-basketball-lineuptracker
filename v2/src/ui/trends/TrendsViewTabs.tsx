import { useRef } from 'preact/hooks';
import type { Lang, StringKey } from '../../i18n/strings';
import { TRENDS_VIEW_IDS, t, type TrendsViewId } from './trendsShared';

/**
 * Segmentbediening van de Trends-tab als toegankelijke tablist (WAI-ARIA
 * tabs-patroon met automatische activering): `role="tablist"`/`tab`,
 * `aria-selected`, `aria-controls` naar het bijbehorende tabpanel, roving
 * tabindex (alleen de gekozen tab is tabbaar) en de toetsen Links/Rechts
 * (omwikkelend), Home en End. De gekozen weergave wordt NIET opgeslagen.
 *
 * De bijbehorende `role="tabpanel"`-elementen staan in `TrendsPanel.tsx`;
 * de id's komen uit `tabId`/`panelId` zodat beide kanten gekoppeld blijven.
 */

export const tabId = (view: TrendsViewId): string => `trends-tab-${view}`;
export const panelId = (view: TrendsViewId): string => `trends-tabpanel-${view}`;

const LABEL_KEYS: Record<TrendsViewId, StringKey> = {
  overview: 'trendsViewOverview',
  lineups: 'trendsViewLineups',
  players: 'trendsViewPlayers',
  quarters: 'trendsViewQuarters',
};

export interface TrendsViewTabsProps {
  lang: Lang;
  view: TrendsViewId;
  onChange: (next: TrendsViewId) => void;
}

export function TrendsViewTabs({ lang, view, onChange }: TrendsViewTabsProps) {
  const refs = useRef<Partial<Record<TrendsViewId, HTMLButtonElement | null>>>({});

  function select(next: TrendsViewId): void {
    onChange(next);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: KeyboardEvent): void {
    const i = TRENDS_VIEW_IDS.indexOf(view);
    const last = TRENDS_VIEW_IDS.length - 1;
    let target: number | null = null;
    if (e.key === 'ArrowRight') target = i === last ? 0 : i + 1;
    else if (e.key === 'ArrowLeft') target = i === 0 ? last : i - 1;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = last;
    if (target === null) return;
    e.preventDefault();
    select(TRENDS_VIEW_IDS[target]!);
  }

  return (
    <div
      className="trends-tabs"
      role="tablist"
      aria-label={t(lang, 'trendsViewsLabel')}
      data-testid="trends-tablist"
    >
      {TRENDS_VIEW_IDS.map((id) => {
        const selected = id === view;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={tabId(id)}
            className={`trends-tab${selected ? ' trends-tab--active' : ''}`}
            aria-selected={selected}
            aria-controls={panelId(id)}
            tabIndex={selected ? 0 : -1}
            data-testid={`trends-tab-${id}`}
            ref={(el) => {
              refs.current[id] = el;
            }}
            onClick={() => onChange(id)}
            onKeyDown={onKeyDown}
          >
            {t(lang, LABEL_KEYS[id])}
          </button>
        );
      })}
    </div>
  );
}
