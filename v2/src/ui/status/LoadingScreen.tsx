import { translate, type Lang } from '../../i18n/strings';

export interface LoadingScreenProps {
  lang: Lang;
  /**
   * Namen van stappen die na een begrensde time-out nog niet zijn afgerond
   * (PR 5.3d-vervolgonderzoek: bounded-timeout-diagnostiek voor App.tsx's
   * settings/roster-read en -subscribe, zodat een e2e-test of een
   * ontwikkelaar kan zien WELKE stap vastzit i.p.v. alleen "LoadingScreen
   * blijft staan"). Leeg/afwezig in de normale, snel-ladende situatie.
   */
  stalledSteps?: string[];
}

export function LoadingScreen({ lang, stalledSteps }: LoadingScreenProps) {
  return (
    <div className="app">
      <main className="app-main">
        <p data-testid="loading-screen">{translate(lang, 'authLoadingTitle')}</p>
        {stalledSteps && stalledSteps.length > 0 ? (
          <p data-testid="loading-stalled" data-steps={stalledSteps.join(',')} role="alert">
            {stalledSteps.join(', ')}
          </p>
        ) : null}
      </main>
    </div>
  );
}
