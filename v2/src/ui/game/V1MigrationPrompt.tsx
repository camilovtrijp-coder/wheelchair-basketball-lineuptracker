import type { ActiveGame } from '../../domain/game/types';
import { deriveGameHistory } from '../../domain/game/tracking';
import { translate, type Lang, type StringKey } from '../../i18n/strings';

export interface V1MigrationPromptProps {
  lang: Lang;
  /** Voorstel uit `GameRepository.detectV1Migration()` — nog niet opgeslagen. */
  game: ActiveGame;
  /** Weergavenaam van de organisatie, met organizationId als fallback (zie App.tsx). */
  organizationName: string;
  /** Weergavenaam van het team, met teamId als fallback (zie App.tsx). */
  teamName: string;
  canWrite: boolean;
  saveError: boolean;
  onConfirm: () => void;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

/**
 * Toont een gedetecteerde, nog niet bevestigde v1-actieve-wedstrijd (zie
 * `LocalStorageGameRepository.detectV1Migration()`) en laat de gebruiker
 * expliciet bevestigen dat het huidige team het juiste doel is, in plaats
 * van 'm stilzwijgend aan welk team dan ook toe te wijzen — v1 kende geen
 * organisatie/teamcontext, dus alleen de gebruiker kan dat bevestigen (zie
 * de externe PR-6.1-review, aug. 2026). Vervangt `GameSetupPanel` op het
 * Wedstrijd-tabblad zolang dit voorstel openstaat.
 *
 * Toont zowel organisatie- als teamnaam (niet alleen teamnaam): bij
 * gelijknamige teams in twee verschillende organisaties zou de teamnaam
 * alleen geen ondubbelzinnig doel zijn — precies de tweede blokkerende
 * bevinding van de derde herreview (aug. 2026).
 */
export function V1MigrationPrompt({
  lang,
  game,
  organizationName,
  teamName,
  canWrite,
  saveError,
  onConfirm,
}: V1MigrationPromptProps) {
  const history = deriveGameHistory(game);

  return (
    <section className="settings-panel" aria-label={t(lang, 'v1MigrationTitle')}>
      <header className="settings-panel__header">
        <h2>{t(lang, 'v1MigrationTitle')}</h2>
      </header>
      <p className="settings-explainer">{t(lang, 'v1MigrationDesc')}</p>

      <ul className="roster-list">
        <li className="roster-player-card">
          <span className="settings-field__label">{t(lang, 'teamOpponent')}</span>{' '}
          <strong data-testid="v1-migration-opponent">{game.opponent || '—'}</strong>
        </li>
        <li className="roster-player-card">
          <span className="settings-field__label">{t(lang, 'v1MigrationTargetLabel')}</span>{' '}
          <strong data-testid="v1-migration-target">
            {organizationName} / {teamName}
          </strong>
        </li>
        <li className="roster-player-card">
          <span className="settings-field__label">{t(lang, 'v1MigrationScoreLabel')}</span>{' '}
          <strong data-testid="v1-migration-score">
            {history.scoreFor} – {history.scoreAgainst}
          </strong>
        </li>
      </ul>

      <p className="settings-explainer">{t(lang, 'v1MigrationSwitchHint')}</p>

      {saveError ? (
        <p className="settings-error" role="alert" data-testid="game-save-error">
          {t(lang, 'gameSaveError')}
        </p>
      ) : null}

      {canWrite ? (
        <div className="settings-actions">
          <button
            type="button"
            className="btn-primary"
            data-testid="v1-migration-confirm"
            onClick={onConfirm}
          >
            {t(lang, 'v1MigrationConfirmBtn')}
          </button>
        </div>
      ) : (
        <p className="settings-read-only" data-testid="game-read-only" role="status">
          {t(lang, 'gameReadOnly')}
        </p>
      )}
    </section>
  );
}
