import { useState } from 'preact/hooks';
import type { Player, Roster } from '../../domain/roster/types';
import {
  addPlayer,
  findDuplicateNumbers,
  removePlayer,
  updatePlayerField,
} from '../../domain/roster/normalize';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { getRoster, saveRoster } from '../../application/roster/usecases';
import type { RosterRepository } from '../../application/roster/RosterRepository';

export interface RosterPanelProps {
  lang: Lang;
  repo: RosterRepository;
  roster: Roster;
  onRosterChange: (next: Roster) => void;
  useClassLimit: boolean;
  tag1Label: string;
  tag2Label: string;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

export function RosterPanel({
  lang,
  repo,
  roster,
  onRosterChange,
  useClassLimit,
  tag1Label,
  tag2Label,
}: RosterPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const dupNrs = findDuplicateNumbers(roster);

  function handleField<K extends keyof Player>(id: number, field: K, value: Player[K]) {
    onRosterChange(updatePlayerField(roster, id, field, value));
  }

  function handleAdd() {
    onRosterChange(addPlayer(roster));
  }

  function handleRemove(id: number) {
    if (!window.confirm(t(lang, 'confirmDeletePlayer'))) return;
    onRosterChange(removePlayer(roster, id));
  }

  function handleSave() {
    const ok = saveRoster(repo, roster);
    setError(ok ? null : t(lang, 'settingsSaveError'));
  }

  function handleRefresh() {
    onRosterChange(getRoster(repo));
    setError(null);
  }

  return (
    <section className="settings-panel" aria-label={t(lang, 'rosterTitle')}>
      <header className="settings-panel__header">
        <h2>{t(lang, 'rosterTitle')}</h2>
      </header>
      <p className="settings-explainer">{t(lang, 'rosterIntro')}</p>

      <ul className="roster-list">
        {roster.map((p) => {
          const dup = dupNrs.includes(String(p.nr).trim());
          return (
            <li key={p.id} className="roster-player-card">
              <div className="roster-player-row">
                <label className="settings-field roster-player-nr">
                  <span className="settings-field__label">{t(lang, 'playerNrLabel')}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    className={dup ? 'roster-nr-input roster-nr-input--dup' : 'roster-nr-input'}
                    value={p.nr}
                    data-testid={`roster-nr-${p.id}`}
                    onChange={(e) => handleField(p.id, 'nr', (e.target as HTMLInputElement).value)}
                  />
                </label>
                <label className="settings-field roster-player-name">
                  <span className="settings-field__label">{t(lang, 'playerNameLabel')}</span>
                  <input
                    type="text"
                    value={p.naam}
                    data-testid={`roster-naam-${p.id}`}
                    onChange={(e) =>
                      handleField(p.id, 'naam', (e.target as HTMLInputElement).value)
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn-outline roster-remove-btn"
                  aria-label={t(lang, 'removePlayerBtn')}
                  data-testid={`roster-remove-${p.id}`}
                  onClick={() => handleRemove(p.id)}
                >
                  ✕
                </button>
              </div>

              {useClassLimit ? (
                <div className="roster-player-row roster-player-row--class">
                  <label className="settings-field roster-player-kl">
                    <span className="settings-field__label">{t(lang, 'playerClassLabel')}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="roster-kl-input"
                      value={p.kl}
                      data-testid={`roster-kl-${p.id}`}
                      onChange={(e) =>
                        handleField(p.id, 'kl', (e.target as HTMLInputElement).value)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className={`toggle-btn${p.vrouw ? ' toggle-btn--on' : ''}`}
                    aria-pressed={p.vrouw}
                    data-testid={`roster-vrouw-${p.id}`}
                    onClick={() => handleField(p.id, 'vrouw', !p.vrouw)}
                  >
                    {tag1Label}
                  </button>
                  <button
                    type="button"
                    className={`toggle-btn${p.jeugd ? ' toggle-btn--on' : ''}`}
                    aria-pressed={p.jeugd}
                    data-testid={`roster-jeugd-${p.id}`}
                    onClick={() => handleField(p.id, 'jeugd', !p.jeugd)}
                  >
                    {tag2Label}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {dupNrs.length > 0 ? (
        <p className="settings-error" role="alert" data-testid="roster-dup-warning">
          {t(lang, 'dupNumberWarningLabel')} {dupNrs.join(', ')}
        </p>
      ) : null}

      <button
        type="button"
        className="btn-outline roster-add-btn"
        data-testid="roster-add"
        onClick={handleAdd}
      >
        {t(lang, 'addPlayerBtn')}
      </button>

      {error ? (
        <p className="settings-error" role="alert" data-testid="roster-error">
          {error}
        </p>
      ) : null}

      <div className="settings-actions">
        <button
          type="button"
          className="btn-primary"
          data-testid="roster-save"
          onClick={handleSave}
        >
          {t(lang, 'saveBtn')}
        </button>
        <button
          type="button"
          className="btn-outline"
          data-testid="roster-refresh"
          onClick={handleRefresh}
        >
          ↻
        </button>
      </div>
    </section>
  );
}
