import { useEffect, useState } from 'preact/hooks';
import type { CompletedGame } from '../../domain/game/types';
import { combinedCsvForGame, csvFilenameFor } from '../../domain/game/csv';
import { segmentTurnovers } from '../../domain/game/tracking';
import {
  fmtTurnoversPer10,
  sumTurnovers,
  totalSegmentSeconds,
  turnoversPer10,
} from '../../domain/game/turnoverStats';
import { shareOrDownloadCsv } from '../../infrastructure/game/shareOrDownloadCsv';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { CorrectSegmentDialog, describeCorrectableFields } from './CorrectSegmentDialog';
import { DiscardLocalCorrectionDialog } from './DiscardLocalCorrectionDialog';
import { SyncStatusIndicator } from '../sync/SyncStatusIndicator';
import type { SyncState, SyncStatus } from '../../domain/syncState';
import type { CorrectionSyncStatus } from '../../application/game/CompletedGameRepository';

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
   * PR 7.2a, P1-fix (externe review PR #61, derde ronde). PR 7.2c: sinds de
   * tombstone-flow bestaat, betekent dit uitsluitend nog "de afronding is
   * nog niet server-bevestigd" — een server-bevestigd item gaat voortaan via
   * `tombstone()` i.p.v. hier geblokkeerd te worden, zie
   * `App.handleDeleteCompletedGame()`. Aparte banner van `saveError`: dit is
   * geen mislukte opslag, maar een bewust geblokkeerde actie.
   */
  deleteBlocked?: boolean;
  /**
   * PR 7.2c: `true` wanneer de laatste tombstone-verwijderpoging is
   * geprobeerd maar afgewezen/gefaald (Rules, revisiemismatch, netwerk) —
   * los van `deleteBlocked` (dat is een bewust GEBLOKKEERDE, niet-geprobeerde
   * actie). De lokale kopie blijft in dat geval gewoon zichtbaar.
   */
  deleteError?: boolean;
  /**
   * PR 7.2c, externe review op PR #65 (P1 — "een late client verliest zijn
   * lokale bron niet stil"): aantal wedstrijden dat dit apparaat ZOJUIST als
   * getombstoned leerde terwijl het zelf nog een lokale kopie had (zie
   * `CompositeCompletedGameRepository`'s "Niet stil"-docstring). `undefined`
   * (lokale modus) of `0` toont geen banner. `> 0` toont een dismissbare
   * banner — `onDismissTombstoneNotice` wist 'm.
   */
  tombstoneNoticeCount?: number;
  onDismissTombstoneNotice?: () => void;
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
   * PR 7.5b: slaat een gecorrigeerde afgeronde wedstrijd op (`false` = opslaan
   * mislukt). Segmentrijen zijn alleen aantikbaar als dit gezet is én
   * `canWrite` (dezelfde bevoegdheid als verwijderen). `undefined` = geen
   * correctiepad (bv. cloudmodus tot PR 7.5c).
   */
  onCorrectGame?: (corrected: CompletedGame) => boolean;
  /** PR 7.5b: uid voor het correctielogitem; `null`/afwezig in lokale modus. */
  correctedBy?: string | null;
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
  /**
   * PR 7.6a: per-`CompletedGame.id` correctiestatus (uit
   * `CompletedGameRepository.correctionSyncStatus`), uitsluitend gevuld door
   * `App` in cloudmodus. Ontbrekende sleutel of `null` = nooit gecorrigeerd.
   * Per wedstrijd verschijnt ÉÉN indicator: de correctiestatus zolang die niet
   * `gesynchroniseerd`/`null` is, anders de afrondstatus uit `syncStatuses`.
   */
  correctionStatuses?: Record<string, CorrectionSyncStatus | null>;
  /**
   * PR 7.6a: wedstrijden waarvan de afronding in cloudmodus nog niet
   * server-bevestigd is. Corrigeren is daarvoor uitgezet (segmenten niet
   * aantikbaar) met een korte uitleg.
   */
  correctionBlockedIds?: ReadonlySet<string>;
  /**
   * PR 7.6a: bewuste "Opnieuw proberen" voor een mislukte/niet-goedgekeurde
   * correctie-upload (`CompletedGameRepository.retryCorrectionUploads`).
   * Alleen zichtbaar voor `canWrite`. `conflict` heeft hier bewust geen
   * "Opnieuw proberen" (zie `onDiscardLocalCorrection`).
   */
  onRetryCorrectionUploads?: () => void;
  /**
   * PR 7.6b: verwerpt bewust de lokale kopie van wedstrijd `id`
   * (`CompletedGameRepository.discardLocalCorrection`; `false` = mislukt, er is
   * niets gewijzigd). Alleen zichtbaar bij status `conflict` en `canWrite`, en
   * pas na een bevestigingsdialoog. `undefined` = geen verwerp-actie.
   */
  onDiscardLocalCorrection?: (id: string) => boolean;
}

/** PR 7.6a, plan §D.2: één indicator per wedstrijd. */
export function effectiveSyncStatus(
  correction: CorrectionSyncStatus | null | undefined,
  finalize: SyncStatus | undefined,
): CorrectionSyncStatus {
  if (correction != null && correction !== 'gesynchroniseerd') return correction;
  return finalize ?? 'lokaal-beschikbaar';
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

function correctionWhen(iso: string, lang: Lang): string {
  try {
    return new Date(iso).toLocaleString(localeCode(lang));
  } catch {
    return iso;
  }
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
  deleteError,
  tombstoneNoticeCount,
  onDismissTombstoneNotice,
  syncStatuses,
  cloudSync,
  cloudReadError,
  onCorrectGame,
  correctedBy,
  correctionStatuses,
  correctionBlockedIds,
  onRetryCorrectionUploads,
  onDiscardLocalCorrection,
}: HistoryPanelProps) {
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionSaved, setCorrectionSaved] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [discardFailed, setDiscardFailed] = useState(false);
  const open = openId != null ? games.find((g) => g.id === openId) : undefined;
  const openIsConflict = open != null && correctionStatuses?.[open.id] === 'conflict';

  // Een bevestiging hoort bij één conflict: verdwijnt het conflict (of wisselt de
  // geopende wedstrijd), dan begint de volgende keer weer zonder open dialoog.
  const openGameId = open?.id ?? null;
  useEffect(() => {
    setDiscardConfirmOpen(false);
    setDiscardFailed(false);
  }, [openGameId, openIsConflict]);

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

  const deleteErrorBanner = deleteError ? (
    <p className="settings-error" role="alert" data-testid="history-delete-error">
      {t(lang, 'historyDeleteError')}
    </p>
  ) : null;

  const tombstoneNoticeBanner =
    tombstoneNoticeCount != null && tombstoneNoticeCount > 0 ? (
      <p className="settings-error" role="status" data-testid="history-tombstone-notice">
        {tombstoneNoticeCount === 1
          ? t(lang, 'historyTombstoneNoticeSingular')
          : t(lang, 'historyTombstoneNoticePlural').replace(
              '{count}',
              String(tombstoneNoticeCount),
            )}{' '}
        <button
          type="button"
          className="btn-outline"
          data-testid="history-tombstone-notice-dismiss"
          onClick={onDismissTombstoneNotice}
        >
          {t(lang, 'historyTombstoneDismissBtn')}
        </button>
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
    const openTurnovers = sumTurnovers(open.segments);
    const openSeconds = totalSegmentSeconds(open.segments);
    const correctionBlocked = correctionBlockedIds?.has(open.id) === true;
    const canCorrect = canWrite && onCorrectGame != null && !correctionBlocked;
    const correctionStatus = correctionStatuses?.[open.id] ?? null;
    const openStatus = effectiveSyncStatus(correctionStatus, syncStatuses?.[open.id]);
    const correctionHintKey: StringKey | null =
      correctionStatus === 'actie-nodig'
        ? 'correctionActionNeededHint'
        : correctionStatus === 'wacht-op-synchronisatie' ||
            correctionStatus === 'lokaal-beschikbaar'
          ? 'correctionPendingOffline'
          : null;
    const canRetry =
      canWrite &&
      onRetryCorrectionUploads != null &&
      (correctionStatus === 'actie-nodig' ||
        (correctionStatus === 'lokaal-beschikbaar' && !correctionBlocked));
    const canDiscard =
      canWrite && onDiscardLocalCorrection != null && correctionStatus === 'conflict';
    const correctingSegment =
      canCorrect && correctingId != null
        ? open.segments.find((seg) => seg.id === correctingId)
        : undefined;
    const corrections = open.corrections ?? [];
    return (
      <section className="history-panel" aria-label={t(lang, 'historyTitle')}>
        {errorBanner}
        {deleteBlockedBanner}
        {deleteErrorBanner}
        {tombstoneNoticeBanner}
        {cloudReadErrorBanner}
        {correctionSaved ? (
          <p
            className="history-correction-saved"
            role="status"
            data-testid="history-correction-saved"
          >
            {t(lang, 'correctionSaved')}
          </p>
        ) : null}
        <div className="history-detail__actions">
          <button
            type="button"
            className="btn-outline"
            data-testid="history-back-btn"
            onClick={() => {
              setCorrectionSaved(false);
              onOpenChange(null);
            }}
          >
            ← {t(lang, 'backBtn')}
          </button>
          <button
            type="button"
            className="btn-danger"
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
        <h2>
          {open.opponent || t(lang, 'teamOpponent')}
          {corrections.length > 0 ? (
            <span className="correction-badge" data-testid="history-corrected-badge">
              {t(lang, 'correctedBadge')}
            </span>
          ) : null}
        </h2>
        <p className="history-detail__meta">
          {gameDateLabel(open, lang)}
          {open.competition ? ` · ${open.competition}` : ''} · {open.scoreFor} - {open.scoreAgainst}
        </p>
        {syncStatuses ? (
          <SyncStatusIndicator
            lang={lang}
            status={openStatus}
            testId={`history-sync-status-${open.id}`}
          />
        ) : null}
        {correctionStatus === 'conflict' ? (
          <p className="settings-error" role="status" data-testid="history-correction-conflict">
            {t(lang, 'correctionConflictMessage')}
          </p>
        ) : null}
        {canDiscard ? (
          <>
            <p className="segment-list__hint" data-testid="history-correction-discard-hint">
              {t(lang, 'correctionDiscardHint')}
            </p>
            <button
              type="button"
              className="btn-danger"
              data-testid="history-correction-discard-btn"
              onClick={() => {
                setDiscardFailed(false);
                setDiscardConfirmOpen(true);
              }}
            >
              {t(lang, 'correctionDiscardLocal')}
            </button>
          </>
        ) : null}
        {canWrite && correctionHintKey != null ? (
          <p className="segment-list__hint" data-testid="history-correction-hint">
            {t(lang, correctionHintKey)}
          </p>
        ) : null}
        {canRetry ? (
          <button
            type="button"
            className="btn-outline"
            data-testid="history-correction-retry-btn"
            onClick={onRetryCorrectionUploads}
          >
            {t(lang, 'correctionRetry')}
          </button>
        ) : null}
        {canWrite && onCorrectGame != null && correctionBlocked ? (
          <p className="segment-list__hint" role="status" data-testid="history-correction-waiting">
            {t(lang, 'correctionWaitingForFinalize')}
          </p>
        ) : null}
        <p className="history-turnovers-total" data-testid="history-turnovers-total">
          {t(lang, 'historyTurnoversTotal')}: <strong>{openTurnovers}</strong> ·{' '}
          {t(lang, 'historyTurnoversPer10')}:{' '}
          <strong>{fmtTurnoversPer10(turnoversPer10(openTurnovers, openSeconds))}</strong>
        </p>
        {canCorrect ? (
          <p className="segment-list__hint" data-testid="history-correct-hint">
            {t(lang, 'correctSegmentHint')}
          </p>
        ) : null}
        <div className="segment-list">
          {open.segments.map((s) => {
            const pm = s.pf - s.pa;
            const nrs = s.lineup.map((id) => byId.get(id)?.nr ?? '?').join('-');
            const Row = canCorrect ? 'button' : 'div';
            return (
              <Row
                key={s.id}
                {...(canCorrect
                  ? {
                      type: 'button' as const,
                      'aria-label': t(lang, 'correctSegmentAria').replace(
                        '{segment}',
                        `Q${s.quarter} ${nrs} ${fmtSec(s.durSec)}`,
                      ),
                      onClick: () => {
                        setCorrectionSaved(false);
                        setCorrectingId(s.id);
                      },
                    }
                  : {})}
                className={canCorrect ? 'segment-item segment-item--tappable' : 'segment-item'}
                data-testid={`history-segment-${s.id}`}
              >
                <span className="segment-item__lineup">
                  <span className="segment-item__quarter">Q{s.quarter}</span> {nrs}
                </span>
                <span className="segment-item__stats">
                  <span>{fmtSec(s.durSec)}</span>
                  <span className={pmColor(pm)}>
                    {pm >= 0 ? '+' : ''}
                    {pm}
                  </span>
                  {segmentTurnovers(s) >= 1 ? (
                    <span className="turnover-pill" data-testid={`history-segment-tov-${s.id}`}>
                      {t(lang, 'turnoverPillPrefix')} {segmentTurnovers(s)}
                    </span>
                  ) : null}
                </span>
              </Row>
            );
          })}
        </div>
        {corrections.length > 0 ? (
          <details className="correction-log" data-testid="history-corrections">
            <summary>
              {t(lang, 'correctionsHistory')} ({corrections.length})
            </summary>
            <ul>
              {corrections.map((c) => (
                <li key={c.id} data-testid={`history-correction-${c.id}`}>
                  <span className="correction-log__when">
                    {t(lang, 'correctionsHistoryEntry').replace(
                      '{when}',
                      correctionWhen(c.at, lang),
                    )}
                  </span>
                  <span className="correction-log__before">
                    {t(lang, 'correctBeforeLabel')}: {describeCorrectableFields(c.before, lang)}
                  </span>
                  <span className="correction-log__after">
                    {t(lang, 'correctAfterLabel')}: {describeCorrectableFields(c.after, lang)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {correctingSegment && onCorrectGame ? (
          <CorrectSegmentDialog
            key={correctingSegment.id}
            lang={lang}
            game={open}
            segment={correctingSegment}
            by={correctedBy ?? null}
            onSave={(corrected) => {
              const ok = onCorrectGame(corrected);
              if (ok) setCorrectionSaved(true);
              return ok;
            }}
            onClose={() => setCorrectingId(null)}
          />
        ) : null}
        {canDiscard && discardConfirmOpen ? (
          <DiscardLocalCorrectionDialog
            lang={lang}
            failed={discardFailed}
            onCancel={() => {
              setDiscardConfirmOpen(false);
              setDiscardFailed(false);
            }}
            onConfirm={() => {
              if (onDiscardLocalCorrection(open.id)) {
                setDiscardConfirmOpen(false);
                setDiscardFailed(false);
                setCorrectionSaved(false);
              } else {
                setDiscardFailed(true);
              }
            }}
          />
        ) : null}
        <button
          type="button"
          className="btn-success history-detail__export"
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
      {deleteErrorBanner}
      {tombstoneNoticeBanner}
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
                    {(g.corrections?.length ?? 0) > 0 ? (
                      <span
                        className="correction-badge"
                        data-testid={`history-item-corrected-${g.id}`}
                      >
                        {t(lang, 'correctedBadge')}
                      </span>
                    ) : null}
                  </span>
                  <span className="history-item__date">
                    {gameDateLabel(g, lang)}
                    {g.competition ? ` · ${g.competition}` : ''}
                  </span>
                </span>
                <span className="history-item__end">
                  <span
                    className={`history-item__dot history-item__dot--${pm > 0 ? 'pos' : pm < 0 ? 'neg' : 'flat'}`}
                    aria-hidden="true"
                  />
                  <span className={`history-item__score ${pmColor(pm)}`}>
                    {g.scoreFor} - {g.scoreAgainst}
                  </span>
                  {syncStatuses ? (
                    <SyncStatusIndicator
                      lang={lang}
                      status={effectiveSyncStatus(correctionStatuses?.[g.id], syncStatuses[g.id])}
                      testId={`history-sync-status-${g.id}`}
                    />
                  ) : null}
                  <svg
                    className="history-item__chevron"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
