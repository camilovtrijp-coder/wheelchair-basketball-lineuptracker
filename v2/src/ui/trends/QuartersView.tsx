import { t, type TrendsViewProps } from './trendsShared';

/**
 * Weergave "Kwarten" (T3: alleen een nette lege staat). De inhoud (team +/-,
 * Voor/Tegen per 10 min en speelminuten per speler per kwart) wordt in
 * stap T5 gevuld door hier de lege staat te vervangen.
 *
 * Invoer: `TrendsViewProps` (zie `trendsShared.ts`). Voor T5 relevant:
 * `games`, `gameIds`, `per10`, `minSec`, `roster` en `lang`.
 */
export function QuartersView({ lang }: TrendsViewProps) {
  return (
    <div className="trends-quarters" data-testid="trends-quarters">
      <div className="card trends-empty-state" data-testid="trends-quarters-empty">
        <div className="sm trends-empty-state__title">{t(lang, 'trendsQuartersEmptyTitle')}</div>
        <p className="xs mut2">{t(lang, 'trendsQuartersEmptyText')}</p>
      </div>

      {/* T5: kwartweergave (computeQuarterSplits, minuten per speler per kwart) komt hier. */}
    </div>
  );
}
