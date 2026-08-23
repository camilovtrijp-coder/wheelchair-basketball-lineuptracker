import type { Settings } from '../settings/types';
import type { Roster } from '../roster/types';
import type { ActiveGame, CompletedGame } from '../game/types';
import type { OrganizationRole } from '../organizations/types';
import type { MigrationContextFingerprint } from './capability';

/**
 * PR 7.4a (docs/pr-7.4-plan.md §C 7.4a): pure datatypes voor de cloud-
 * migratiepreview. Geen Firebase-/storage-import — zie `preview.ts` voor de
 * bouwfunctie en `inventory.ts`/`localInventory.ts` voor de invoer. Hergebruikt
 * bewust GEEN `domain/backup`-types (`ImportPreview`/`BackupV2Data`): dit is
 * geen tweede back-upimporter (plan §A: "Deze PR is geen tweede algemene
 * back-upimporter"), de vorm hieronder draagt bron/doel-ID's, conflict-/
 * duplicaatstatus en een trackinggame-status die `ImportPreview` niet kent.
 */

export type LocalSectionStatus = 'ok' | 'empty' | 'corrupt';

/** Eén gecontroleerde lokale sectie, met de reden bij `'corrupt'` (herbruikt
 * `BackupValidationError`-vorm uit `domain/backup/validate.ts` — dezelfde
 * gestructureerde foutcodes, want dezelfde sectievalidators worden hergebruikt,
 * zie `localInventory.ts`). */
export interface LocalMigrationSection<T> {
  status: LocalSectionStatus;
  value: T | null;
  errors: { code: string; detail?: string }[];
}

export interface LocalMigrationInventory {
  organizationId: string;
  teamId: string;
  settings: LocalMigrationSection<Settings & Record<string, unknown>>;
  roster: LocalMigrationSection<Roster>;
  activeGame: LocalMigrationSection<ActiveGame | null>;
  completedGames: LocalMigrationSection<CompletedGame[]>;
}

/**
 * Reeds-aanwezige clouditems in de DOELcontext, vooraf gelezen (read-only,
 * plan §C 7.4a: "bestaande clouditems" horen bij de preview, niet bij een
 * schrijfactie) — puur data, de aanroeper (application/infrastructure)
 * levert dit aan, deze module doet zelf geen enkele Firestore-call.
 * `null`/afwezig item betekent "nog niet in de cloud aanwezig", niet "leeg
 * document" (settings/roster: `present: false` == cloud-document bestaat
 * nog niet, spiegelt `FirestoreSettingsRepository`'s `documentExists`).
 */
export interface CloudExistingSnapshot {
  settings: { present: boolean; hash: string | null };
  roster: { present: boolean; hash: string | null };
  /** Sleutel: `CompletedGame.id` (v2-UUID, zie `fingerprint.ts`). */
  completedGames: ReadonlyMap<string, { hash: string }>;
  /** Aanwezig als de doelcontext al een cloud-`games/{activeGame.id}`-document heeft. */
  activeGame: { present: boolean; hash: string | null; phase: 'setup' | 'tracking' | null };
}

export type MigrationItemKind = 'settings' | 'roster' | 'activeGame' | 'completedGame';

/**
 * `'create'`: nog niet aanwezig in de doelcontext, een write zou 'm aanmaken.
 * `'alreadyPresentIdentical'`: cloud-tegenhanger bestaat al met dezelfde
 * inhoud (payloadhash gelijk) — plan §C 7.4b werk 4: "Detecteer semantisch
 * gelijke bestaande items als bevestigd", 7.4a rapporteert dit alvast als
 * "geen write nodig". `'conflict'`: cloud-tegenhanger bestaat met AFWIJKENDE
 * inhoud onder hetzelfde doel-ID — nooit een overwrite (plan §C 7.4b werk 4),
 * 7.4a markeert dit zichtbaar zodat 7.4c een aparte beslissing kan vragen.
 * `'excludedTrackingGame'`: de actieve wedstrijd is in `tracking`-fase — niet
 * bulkmigreerbaar (§B), zie `trackingGame` op `CloudMigrationPreview`.
 * `'needsSeparateDecision'`: een `setup`-fase actieve wedstrijd — mag alleen
 * mee na een aparte previewbeslissing (§B).
 */
export type MigrationItemAction =
  | 'create'
  | 'alreadyPresentIdentical'
  | 'conflict'
  | 'excludedTrackingGame'
  | 'needsSeparateDecision';

export interface CloudMigrationItem {
  kind: MigrationItemKind;
  /** Bron-ID (zie `fingerprint.ts`) — `'current'` voor de singleton-documenten settings/roster. */
  sourceId: string;
  /** Doel-ID — voor de huidige broncontexten altijd gelijk aan `sourceId` (§B, zie `fingerprint.ts`). */
  targetId: string;
  /** Mensleesbare naam voor de preview-UI (7.4c) — bijv. teamnaam, tegenstander, of aantal spelers. */
  label: string;
  action: MigrationItemAction;
  payloadHash: string;
}

export type MigrationDenialReason = 'roleDenied' | 'corruptSource' | 'contextAmbiguous';

/** Eén niet-blokkerende waarschuwing (in tegenstelling tot een `MigrationDenialReason`,
 * die de HELE preview weigert vóór er ook maar één item gebouwd wordt). */
export interface CloudMigrationWarning {
  code:
    | 'settingsCorrupt'
    | 'rosterCorrupt'
    | 'activeGameCorrupt'
    | 'completedGamesCorrupt'
    | 'activeGameTracking'
    | 'activeGameSetupNeedsDecision'
    | 'settingsEmpty'
    | 'rosterEmpty'
    | 'itemConflict'
    | 'duplicateTeamNameAcrossOrganizations';
  detail?: string;
}

export interface MigrationContextRef {
  organizationId: string;
  teamId: string;
  organizationName: string;
  teamName: string;
}

/**
 * Puur, deterministisch resultaat van `buildCloudMigrationPreview()` (plan
 * werk 2/3). `allowed: false` betekent: geen enkele write mag hierop volgen,
 * ongeacht wat de gebruiker daarna doet — de UI (7.4c) mag "bevestigen" dan
 * niet eens tonen. `manifestHash` dekt ALLES behalve `builtAt` (dezelfde
 * bron/doelcombinatie + dezelfde lokale/cloud-inhoud levert dus altijd
 * dezelfde hash op, ook op een ander moment gebouwd — vereist voor 7.4b's
 * "is er iets veranderd sinds de laatste preview"-check).
 */
export interface CloudMigrationPreview {
  builtAt: string;
  source: MigrationContextRef;
  target: MigrationContextRef;
  callerRole: OrganizationRole;
  /** Bindt deze preview aan `(target.organizationId, target.teamId, callerRole)` — zie `capability.ts`. */
  contextFingerprint: MigrationContextFingerprint;
  allowed: boolean;
  denialReason: MigrationDenialReason | null;
  items: CloudMigrationItem[];
  trackingGame: {
    present: boolean;
    opponent: string | null;
    gameId: string | null;
  };
  warnings: CloudMigrationWarning[];
  counts: {
    create: number;
    alreadyPresentIdentical: number;
    conflict: number;
  };
  /** Aantal writes dat een bevestigde 7.4b-run zou uitvoeren voor de HUIDIGE preview
   * (excl. `excludedTrackingGame`/`needsSeparateDecision` — die vereisen eerst een
   * aparte beslissing, §B). */
  requiredWrites: number;
  manifestHash: string;
}
