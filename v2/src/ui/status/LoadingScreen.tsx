import { translate, type Lang } from '../../i18n/strings';

export interface LoadingScreenProps {
  lang: Lang;
}

export function LoadingScreen({ lang }: LoadingScreenProps) {
  return (
    <div className="app">
      <main className="app-main">
        <p data-testid="loading-screen">{translate(lang, 'authLoadingTitle')}</p>
      </main>
    </div>
  );
}
