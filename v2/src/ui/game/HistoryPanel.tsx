import type { CompletedGame } from '../../domain/game/types';
import { combinedCsvForGame, csvFilenameFor } from '../../domain/game/csv';
import { shareOrDownloadCsv } from '../../infrastructure/game/shareOrDownloadCsv';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { SyncStatusIndicator } from '../sync/SyncStatusIndicator';
import type { SyncState, SyncStatus } from '../../domain/syncState';

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
  /** Externe PR-6.3-review (aug. 2026): een mislukte save/delete op deze tab
   * bleef eerder onzichtbaar totdat de gebruiker naar een ander tabblad
   * navigeerde (`gameSaveError` werd alleen door GameSetupPanel/
   * LiveTrackingPanel getoond). */
  saveError: boolean;
  /**
   * PR 7.2a, P1-fix (externe review PR #61, derde ronde); tekst/reikwijdte
   * uitgebreid in PR 7.2b: `true` wanneer de laatste verwijderpoging is
   * afgewezen — óf omdat de afronding nog niet server-bevestigd is, óf
   * (PR 7.2b) omdat de wedstrijd al wél server-bevestigd is en verwijderen
   * van een gesynchroniseerde/cloud-only wedstrijd pas met de PR 7.2c-
   * tombstone-flow ondersteund wordt — zie `App.handleDeleteCompletedGame()`.
   * Aparte banner van `saveError`: dit is geen mislukte opslag, maar een
   * bewust geblokkeerde actie.
   */
  deleteBlocked?: boolean;
  /**
   * PR 7.2b: van de team-brede cloudhistoriequery afgeleide `SyncState` (zie
   * `CompositeCompletedGameRepository`/`FirestoreCompletedGameRepository`),
   * uitsluitend gevuld door `App` in cloud-modus. `undefined` (lokale modus)
   * betekent: toon geen lijstbrede syncbadge. `null` (cloud-modus, nog geen
   * enkele cloud-snapshot binnengekomen sinds de laatste contextwissel)
   * betekent: de getoonde lijst is nog uitsluitend lokaal — ook dan geen
   * badge, want er is nog niets over de cloudkant te zeggen.
   */
  cloudSync?: SyncState | null;
  /**
   * PR 7.2b: `true` wanneer de laatste cloudhistorielezing is afgewezen
   * (Rules-afwijzing, ingetrokken membership). Een aparte banner van
   * `historyEmpty`: een leesfout op de cloudkant mag NOOIT gelijk getoond
   * worden aan "geen wedstrijden" — de lokale historie in `games` blijft
   * intussen gewoon zichtbaar/bruikbaar.
   */
  cloudReadError?: boolean;
  /**
   * PR 7.2a: per-`CompletedGame.id` cloudsyncstatus, uitsluitend gevuld door
   * `App` in cloud-modus (net als `SyncStatusIndicator` elders — "gesynchro-
   * niseerd" tonen zonder cloud zou misleidend zijn, zie de eigen docstring
   * bij dat component). `undefined` (lokale modus, geen `gameSync`-coordinator
   * geïnstantieerd) betekent: toon geen syncbadge; een ontbrekende sleutel
   * binnen een wél meegegeven map (cloud-modus, nog geen status bekend voor
   * dit specifieke item) valt terug op `'lokaal-beschikbaar'`.
   */
  syncStatuses?: Record<string, SyncStatus>;
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
  saveError,
  deleteBlocked,
  syncStatuses,
  cloudSync,
  cloudReadError,
}: HistoryPanelProps) {
  const open = openId != null ? games.find((g) => g.id === openId) : undefined;

  const errorBanner = saveError ? (
    <p className="settings-error" role="alert" data-testid="history-save-error">
      {t(lang, 'gameSaveError')}
    </p>
  ) : null;

  const deleteBlockedBanner = deleteBlocked ? (
    <p className="settings-error" role="status" data-testid="history-delete-blocked">
      {t(lang, 'deleteBlockedPendingSync')}
    </p>
  ) : null;

  // PR 7.2b, plan §C 7.2b werk 4: een cloud-leesfout mag nooit gelijk getoond
  // worden aan "geen wedstrijden" — aparte banner, lokale historie blijft
  // gewoon zichtbaar in de lijst eronder.
  const cloudReadErrorBanner = cloudReadError ? (
    <p className="settings-error" role="alert" data-testid="history-cloud-read-error">
      {t(lang, 'historyCloudReadError')}
    </p>
  ) : null;

  // Externe review op PR #64: defense-in-depth naast `App`'s eigen reset van
  // `completedGamesCloudSync` naar `null` bij een cloudfout — toon nooit een
  // (mogelijk verouderde) syncbadge tegelijk met de foutbanner, ook niet als
  // een toekomstige aanroeper `cloudSync` per ongeluk niet resette.
  const cloudSyncIndicator =
    cloudSync != null && !cloudReadError ? (
      <SyncStatusIndicator
        lang={lang}
        status={cloudSync.status}
        fromCache={cloudSync.fromCache}
        testId="history-cloud-sync-status"
      />
    ) : null;

  if (open) {
    const byId = new Map(open.players.map((p) => [p.id, p]));
    return (
      <section className="history-panel" aria-label={t(lang, 'historyTitle')}>
        {errorBanner}
        {deleteBlockedBanner}
        {cloudReadErrorBanner}
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
        {syncStatuses ? (
          <SyncStatusIndicator
            lang={lang}
            status={syncStatuses[open.id] ?? 'lokaal-beschikbaar'}
            testId={`history-sync-status-${open.id}`}
          />
        ) : null}
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
      {errorBanner}
      {deleteBlockedBanner}
      {cloudReadErrorBanner}
      {cloudSyncIndicator}
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
                {syncStatuses ? (
                  <SyncStatusIndicator
                    lang={lang}
                    status={syncStatuses[g.id] ?? 'lokaal-beschikbaar'}
                    testId={`history-sync-status-${g.id}`}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
