import type { OrganizationRole } from '../organizations/types';
import { canBulkMigrate, computeMigrationContextFingerprint } from './capability';
import { hasCorruptSection } from './inventory';
import { payloadHash } from './fingerprint';
import {
  activeGamePayloadHash,
  completedGamePayloadHash,
  rosterPayloadHash,
  settingsPayloadHash,
} from './payload';
import type {
  CloudExistingSnapshot,
  CloudMigrationItem,
  CloudMigrationPreview,
  CloudMigrationWarning,
  LocalMigrationInventory,
  MigrationContextRef,
  MigrationDenialReason,
} from './types';

/**
 * PR 7.4a (docs/pr-7.4-plan.md §C 7.4a werk 2/3/4): de pure kern die 7.4b
 * later hergebruikt om te bepalen WAT geschreven moet worden — zelf schrijft
 * dit bestand NOOIT iets (geen Firebase-import, geen enkele I/O). Bouwt een
 * `CloudMigrationPreview` uit reeds-gelezen invoer:
 * - `inventory`: strikte lokale bron (`inventory.ts` — corrupt/leeg/ok per sectie).
 * - `existingCloud`: reeds-gelezen doelcontext-snapshot (infrastructure levert dit aan).
 * - `callerRole`: de rol van de aanroeper IN DE DOELCONTEXT (§B: bulkmigratie-
 *   bevoegdheid wordt op het doel gecontroleerd, waar geschreven zou worden).
 *
 * Volgorde van beslissingen (werk 4/1, in die volgorde — een latere check
 * wordt nooit bereikt als een eerdere al weigert):
 * 1. Rolcontrole (`canBulkMigrate`) — een scorer/viewer krijgt NOOIT een
 *    itemlijst te zien, ongeacht de brondata (acceptatiecriterium: "een
 *    scorer/viewer krijgt geen bulkactie").
 * 2. Corrupte brondata (`hasCorruptSection`) — stopt vóór er ook maar één
 *    item gebouwd wordt (werk 1: "corrupte of onduidelijke data stopt vóór
 *    iedere cloudwrite").
 * 3. Pas daarna: itemlijst + trackinggame-status + conflict-/duplicaatdetectie.
 */
export interface BuildCloudMigrationPreviewInput {
  now: string;
  source: MigrationContextRef;
  target: MigrationContextRef;
  callerRole: OrganizationRole;
  inventory: LocalMigrationInventory;
  existingCloud: CloudExistingSnapshot;
}

function denialPreview(
  input: BuildCloudMigrationPreviewInput,
  reason: MigrationDenialReason,
  warnings: CloudMigrationWarning[],
): CloudMigrationPreview {
  const contextFingerprint = computeMigrationContextFingerprint({
    organizationId: input.target.organizationId,
    teamId: input.target.teamId,
    role: input.callerRole,
  });
  const base = {
    source: input.source,
    target: input.target,
    callerRole: input.callerRole,
    contextFingerprint,
    allowed: false,
    denialReason: reason,
    items: [] as CloudMigrationItem[],
    trackingGame: { present: false, opponent: null, gameId: null },
    warnings,
    counts: { create: 0, alreadyPresentIdentical: 0, conflict: 0 },
    requiredWrites: 0,
  };
  return {
    ...base,
    builtAt: input.now,
    manifestHash: payloadHash(base),
  };
}

export function buildCloudMigrationPreview(
  input: BuildCloudMigrationPreviewInput,
): CloudMigrationPreview {
  if (!canBulkMigrate(input.callerRole)) {
    return denialPreview(input, 'roleDenied', []);
  }
  const { inventory, existingCloud } = input;

  if (hasCorruptSection(inventory)) {
    const warnings: CloudMigrationWarning[] = [];
    if (inventory.settings.status === 'corrupt') warnings.push({ code: 'settingsCorrupt' });
    if (inventory.roster.status === 'corrupt') warnings.push({ code: 'rosterCorrupt' });
    if (inventory.activeGame.status === 'corrupt') warnings.push({ code: 'activeGameCorrupt' });
    if (inventory.completedGames.status === 'corrupt')
      warnings.push({ code: 'completedGamesCorrupt' });
    return denialPreview(input, 'corruptSource', warnings);
  }

  const warnings: CloudMigrationWarning[] = [];
  const items: CloudMigrationItem[] = [];

  if (inventory.settings.status === 'empty') warnings.push({ code: 'settingsEmpty' });
  if (inventory.roster.status === 'empty') warnings.push({ code: 'rosterEmpty' });
  if (
    input.source.organizationId !== input.target.organizationId &&
    input.source.teamName === input.target.teamName
  ) {
    // Werk 5: "gelijknamige teams in meerdere organisaties" — namen alleen
    // zijn NOOIT de identiteitsgrens (die blijft altijd organizationId/teamId,
    // zie elk item hieronder), maar de gebruiker moet dit wél zichtbaar
    // gewaarschuwd worden vóór bevestiging — een gelijke naam over org-grenzen
    // heen is een reëel verwarringsrisico bij een bevestigingsscherm (7.4c).
    warnings.push({ code: 'duplicateTeamNameAcrossOrganizations', detail: input.target.teamName });
  }

  if (inventory.settings.status === 'ok' && inventory.settings.value) {
    const hash = settingsPayloadHash(inventory.settings.value);
    items.push({
      kind: 'settings',
      sourceId: 'current',
      targetId: 'current',
      label: inventory.settings.value.teamName || '(zonder teamnaam)',
      action: resolveAction(hash, existingCloud.settings.present, existingCloud.settings.hash),
      payloadHash: hash,
    });
  }

  if (inventory.roster.status === 'ok' && inventory.roster.value) {
    const hash = rosterPayloadHash(inventory.roster.value);
    items.push({
      kind: 'roster',
      sourceId: 'current',
      targetId: 'current',
      label: `${inventory.roster.value.length} speler(s)`,
      action: resolveAction(hash, existingCloud.roster.present, existingCloud.roster.hash),
      payloadHash: hash,
    });
  }

  let trackingGame: CloudMigrationPreview['trackingGame'] = {
    present: false,
    opponent: null,
    gameId: null,
  };
  if (inventory.activeGame.status === 'ok' && inventory.activeGame.value) {
    const game = inventory.activeGame.value;
    if (game.phase === 'tracking') {
      // §B: "Een actieve wedstrijd in `tracking` wordt niet bulk gemigreerd."
      // — expliciet UITGESLOTEN van `items`, apart gerapporteerd zodat de
      // preview 'm nooit stilzwijgend meetelt of verbergt.
      trackingGame = { present: true, opponent: game.opponent, gameId: game.id };
      warnings.push({ code: 'activeGameTracking', detail: game.id });
      items.push({
        kind: 'activeGame',
        sourceId: game.id,
        targetId: game.id,
        label: game.opponent || '(zonder tegenstander)',
        action: 'excludedTrackingGame',
        payloadHash: activeGamePayloadHash(game),
      });
    } else {
      // `phase === 'setup'`: §B "Een setup zonder bevestigde acties mag
      // alleen na afzonderlijke previewbeslissing mee" — dus WEL in de
      // itemlijst (zichtbaar, telbaar), maar met een actie die 7.4b nooit
      // automatisch in `requiredWrites` meetelt.
      warnings.push({ code: 'activeGameSetupNeedsDecision', detail: game.id });
      items.push({
        kind: 'activeGame',
        sourceId: game.id,
        targetId: game.id,
        label: game.opponent || '(zonder tegenstander)',
        action: 'needsSeparateDecision',
        payloadHash: activeGamePayloadHash(game),
      });
    }
  }

  if (inventory.completedGames.status === 'ok' && inventory.completedGames.value) {
    for (const game of inventory.completedGames.value) {
      const hash = completedGamePayloadHash(game);
      const existing = existingCloud.completedGames.get(game.id);
      items.push({
        kind: 'completedGame',
        sourceId: game.id,
        targetId: game.id,
        label: `${game.opponent || '(zonder tegenstander)'} — ${game.date}`,
        action: resolveAction(hash, existing !== undefined, existing?.hash ?? null),
        payloadHash: hash,
      });
    }
  }

  for (const item of items) {
    if (item.action === 'conflict')
      warnings.push({ code: 'itemConflict', detail: `${item.kind}:${item.sourceId}` });
  }

  const counts = {
    create: items.filter((i) => i.action === 'create').length,
    alreadyPresentIdentical: items.filter((i) => i.action === 'alreadyPresentIdentical').length,
    conflict: items.filter((i) => i.action === 'conflict').length,
  };

  const contextFingerprint = computeMigrationContextFingerprint({
    organizationId: input.target.organizationId,
    teamId: input.target.teamId,
    role: input.callerRole,
  });

  const base = {
    source: input.source,
    target: input.target,
    callerRole: input.callerRole,
    contextFingerprint,
    allowed: true,
    denialReason: null as MigrationDenialReason | null,
    items,
    trackingGame,
    warnings,
    counts,
    requiredWrites: counts.create,
  };

  // `manifestHash` (werk 4/`MigrationCoordinator.prepareRun()`'s `runId`) hoort
  // UITSLUITEND af te hangen van de LOKALE brondata (per item alleen `payloadHash`,
  // nooit `action`) en de vaste context — niet van `counts`/`requiredWrites`/
  // conflict-`warnings`, die alle drie AFGELEID zijn van `existingCloud` (de
  // huidige clouddoelstand op het moment van bouwen). Reproduceerbaar bevestigd
  // (externe review, aug. 2026, tegen een echte Firestore-emulator): zodra een
  // run gedeeltelijk voltooid is (bijv. het settings-item is al geschreven) en de
  // gebruiker herlaadt/hervat, verandert dat item se `action` van `'create'` naar
  // `'alreadyPresentIdentical'` in de HERVATTE preview — met de volledige `base`
  // (incl. `action`/`counts`) als hash-invoer kreeg die hervatte preview dan een
  // ANDERE `manifestHash` dan de oorspronkelijke run, waardoor `prepareRun()` de
  // hervatting ten onrechte als een botsende TWEEDE migratie zag en blokkeerde
  // (`blockedByExistingRunId`) i.p.v. 'm te hervatten — precies het scenario dat
  // `migration-flow.spec.ts` werk 4.3/4.4 ("crash/reload ná bevestiging, hervat
  // dezelfde run") test. Dit spiegelt exact de bestaande determinisme-eis
  // hierboven ("dezelfde bron/doelcombinatie levert exact hetzelfde manifest") —
  // "bron/doelcombinatie" is per definitie lokale data + context, nooit de
  // vluchtige clouddoelstand.
  //
  // Zelfde reden om ALLEEN `organizationId`/`teamId` te hashen, nooit de
  // volledige `source`/`target`-ref: `organizationName`/`teamName` zijn pure
  // WEERGAVELABELS — `app/App.tsx` geeft `teamName` door als
  // `settings.teamName || teamId` (fallback op de team-ID zolang er nog geen
  // teamnaam bekend is). Zodra het settings-item in een eerdere ronde al
  // gemigreerd is, verandert die live cloud-`settings`-listener de PROP-
  // waarde van "teamId-fallback" naar de zojuist gemigreerde teamnaam — een
  // hervatte preview zou zo, via exact hetzelfde partial-progress-mechanisme
  // als hierboven, alsnog een andere `manifestHash` krijgen (gereproduceerd
  // tegen een echte Firestore-emulator). `organizationId`/`teamId` zijn de
  // enige STABIELE identiteit van de doelcontext.
  const manifestIdentity = {
    source: { organizationId: input.source.organizationId, teamId: input.source.teamId },
    target: { organizationId: input.target.organizationId, teamId: input.target.teamId },
    callerRole: input.callerRole,
    contextFingerprint,
    trackingGame,
    items: items.map((item) => ({
      kind: item.kind,
      sourceId: item.sourceId,
      targetId: item.targetId,
      payloadHash: item.payloadHash,
    })),
  };

  return {
    ...base,
    builtAt: input.now,
    manifestHash: payloadHash(manifestIdentity),
  };
}

/** Vergelijkt de lokale content-hash tegen een eventueel al bestaand
 * clouditem (plan §C 7.4b werk 4-precedent, hier alvast als preview-
 * rapportage): geen tegenhanger → `'create'`; gelijke hash → semantisch
 * identiek → `'alreadyPresentIdentical'` (geen write nodig); afwijkende hash
 * onder hetzelfde doel-ID → `'conflict'` (nooit stilzwijgend overwriten).
 * Geëxporteerd (PR 7.4b) — `application/migration/MigrationCoordinator.ts`
 * hergebruikt EXACT dezelfde formule voor de "vlak voor bevestiging"-recheck
 * (werk 4), geen tweede, divergerende implementatie. */
export function resolveAction(
  localHash: string,
  existingPresent: boolean,
  existingHash: string | null,
): 'create' | 'alreadyPresentIdentical' | 'conflict' {
  if (!existingPresent) return 'create';
  return existingHash === localHash ? 'alreadyPresentIdentical' : 'conflict';
}
