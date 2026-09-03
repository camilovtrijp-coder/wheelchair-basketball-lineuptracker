export const MATRIX_ACTORS = [
  "unauthenticated",
  "signedInBootstrap",
  "invitedVerifiedUser",
  "organizationOwner",
  "organizationAdmin",
  "coach",
  "scorer",
  "viewer",
  "teamOnlyMember",
] as const;

export type MatrixActor = (typeof MATRIX_ACTORS)[number];
export type MatrixOperation = "read" | "create" | "update" | "delete";

export interface FirestoreAccessMatrixEntry {
  id: string;
  path: string;
  /** Letterlijke match-frase die in firestore.rules aanwezig moet blijven. */
  ruleMatch: string;
  permissions: Record<MatrixOperation, readonly MatrixActor[]>;
  conditions: string;
  evidence: readonly string[];
  clientSources: readonly string[];
  /**
   * Namen van de `firebase/src/documents`-converters (`export const
   * xConverter`) die dit pad daadwerkelijk lezen/schrijven. Leeg alleen
   * wanneer het pad bewust geen eigen converter heeft — de reden staat dan in
   * `conditions`. `firestoreAccessMatrix.spec.ts` controleert dit in beide
   * richtingen tegen `firebase/src/documents` en tegen `clientSources`.
   */
  converterSources: readonly string[];
}

/**
 * Elk bestand onder `v2/src/infrastructure` dat rechtstreeks een Firestore-
 * pad opbouwt (`doc(`/`collection(`/`collectionGroup(`). `firestore
 * AccessMatrix.spec.ts` ontdekt deze lijst ook automatisch vanaf de
 * bestandsboom en faalt als deze constante ooit afwijkt van de werkelijke
 * bronbestanden — een vergeten nieuw gatewaybestand kan deze lijst dus niet
 * meer stilzwijgend passeren.
 */
export const FIRESTORE_CLIENT_GATEWAY_FILES = [
  "../v2/src/infrastructure/organizations/FirestoreOrganizationGateway.ts",
  "../v2/src/infrastructure/settings/FirestoreSettingsRepository.ts",
  "../v2/src/infrastructure/roster/FirestoreRosterRepository.ts",
  "../v2/src/infrastructure/game/FirestoreGameCloudGateway.ts",
  "../v2/src/infrastructure/game/FirestoreCompletedGameRepository.ts",
  "../v2/src/infrastructure/migration/FirestoreCloudMigrationRunGateway.ts",
  "../v2/src/infrastructure/migration/FirestoreCloudMigrationInventoryGateway.ts",
  "../v2/src/infrastructure/migration/FirestoreMigrationWriteGateway.ts",
] as const;

const orgRoles: MatrixActor[] = [
  "organizationOwner",
  "organizationAdmin",
  "coach",
  "scorer",
  "viewer",
];
const teamReaders: MatrixActor[] = [
  "organizationOwner",
  "organizationAdmin",
  "coach",
  "scorer",
  "viewer",
  "teamOnlyMember",
];
const teamManagers: MatrixActor[] = [
  "organizationOwner",
  "organizationAdmin",
  "coach",
];
const gameWriters: MatrixActor[] = [
  "organizationOwner",
  "organizationAdmin",
  "coach",
  "scorer",
];

/**
 * PR 8.3a machineleesbare security-inventaris. Actorlijsten zijn de maximale
 * kandidaatrollen; `conditions` noemt de aanvullende context-/veldvoorwaarden
 * die altijd door Rules worden afgedwongen. `teamOnlyMember` betekent hier een
 * geldige expliciete teamMembers-rol; de concrete coach/scorer/viewerrechten
 * blijven door die documentrol bepaald.
 */
export const FIRESTORE_ACCESS_MATRIX: readonly FirestoreAccessMatrixEntry[] = [
  {
    id: "organization",
    path: "organizations/{orgId}",
    ruleMatch: "match /organizations/{orgId}",
    permissions: {
      read: orgRoles,
      create: ["signedInBootstrap"],
      update: ["organizationOwner"],
      delete: [],
    },
    conditions:
      "Create has an exact validated shape and createdBy == auth.uid; read requires org membership; owner update is name-only; client hard delete is denied.",
    evidence: [
      "tests/rules/bootstrap-and-invitation-flow.spec.ts",
      "tests/rules/cross-org-isolation.spec.ts",
      "tests/rules/membership-and-roles.spec.ts",
      "tests/rules/parent-document-hardening.spec.ts",
    ],
    clientSources: [FIRESTORE_CLIENT_GATEWAY_FILES[0]],
    converterSources: ["organizationConverter"],
  },
  {
    id: "organization-members",
    path: "organizations/{orgId}/organizationMembers/{uid}",
    ruleMatch: "match /organizationMembers/{uid}",
    permissions: {
      read: orgRoles,
      create: [
        "signedInBootstrap",
        "invitedVerifiedUser",
        "organizationOwner",
        "organizationAdmin",
      ],
      update: ["organizationOwner", "organizationAdmin"],
      delete: ["organizationOwner", "organizationAdmin"],
    },
    conditions:
      "Bootstrap/invitation claim are shape- and getAfter-bound; admins cannot grant/remove owner; self-promotion is denied.",
    evidence: [
      "tests/rules/bootstrap-and-invitation-flow.spec.ts",
      "tests/rules/membership-and-roles.spec.ts",
      "tests/rules/self-promotion.spec.ts",
    ],
    clientSources: [FIRESTORE_CLIENT_GATEWAY_FILES[0]],
    converterSources: ["organizationMemberConverter"],
  },
  {
    id: "invitations",
    path: "organizations/{orgId}/invitations/{invitationId}",
    ruleMatch: "match /invitations/{invitationId}",
    permissions: {
      read: ["organizationOwner", "organizationAdmin", "invitedVerifiedUser"],
      create: ["organizationOwner", "organizationAdmin"],
      update: ["organizationOwner", "organizationAdmin", "invitedVerifiedUser"],
      delete: [],
    },
    conditions:
      "Invitee email must match a verified auth token; status transitions and affected fields are allowlisted; claim is atomic.",
    evidence: [
      "tests/rules/bootstrap-and-invitation-flow.spec.ts",
      "tests/rules/membership-and-roles.spec.ts",
    ],
    clientSources: [FIRESTORE_CLIENT_GATEWAY_FILES[0]],
    converterSources: ["invitationConverter"],
  },
  {
    id: "teams",
    path: "organizations/{orgId}/teams/{teamId}",
    ruleMatch: "match /teams/{teamId}",
    permissions: {
      read: teamReaders,
      create: ["organizationOwner", "organizationAdmin"],
      update: ["organizationOwner", "organizationAdmin"],
      delete: [],
    },
    conditions:
      "Read requires canReadTeam; create has an exact validated shape; owner/admin update is name-only; client hard delete is denied.",
    evidence: [
      "tests/rules/membership-and-roles.spec.ts",
      "tests/rules/cross-org-isolation.spec.ts",
      "tests/rules/team-context-switcher-query.spec.ts",
      "tests/rules/parent-document-hardening.spec.ts",
    ],
    clientSources: [FIRESTORE_CLIENT_GATEWAY_FILES[0]],
    converterSources: ["teamConverter"],
  },
  {
    id: "team-members",
    path: "organizations/{orgId}/teams/{teamId}/teamMembers/{uid}",
    ruleMatch: "match /teamMembers/{uid}",
    permissions: {
      read: teamReaders,
      create: ["organizationOwner", "organizationAdmin"],
      update: ["organizationOwner", "organizationAdmin"],
      delete: ["organizationOwner", "organizationAdmin"],
    },
    conditions:
      "Read requires canReadTeam; create/update only enforce the uid == document-ID invariant. " +
      "Rules do NOT allowlist or shape-validate the role field value on create/update (no `hasOnly`/enum check) — " +
      "an org owner/admin can locally write an arbitrary role string. This never escalates privilege: every " +
      "consuming Rules function (`isOrgOwnerOrAdmin`, `canManageTeamData`, `teamRole` comparisons) is an exact-" +
      "literal allowlist that denies any unrecognized value by default. Tracked as an accepted, non-blocking " +
      "residual threat in docs/security-threat-model.md §7 alongside the same gap on organizationMembers, " +
      "invitations, settings and roster.",
    evidence: [
      "tests/rules/membership-and-roles.spec.ts",
      "tests/rules/team-context-switcher-query.spec.ts",
      "tests/rules/membership-and-roles.spec.ts",
    ],
    clientSources: [FIRESTORE_CLIENT_GATEWAY_FILES[0]],
    converterSources: ["teamMemberConverter"],
  },
  {
    id: "settings",
    path: "organizations/{orgId}/teams/{teamId}/settings/current",
    ruleMatch: "match /settings/{settingsId}",
    permissions: {
      read: teamReaders,
      create: teamManagers,
      update: teamManagers,
      delete: teamManagers,
    },
    conditions:
      "Only document ID current; canManageTeamData is required for every write.",
    evidence: [
      "tests/rules/membership-and-roles.spec.ts",
      "tests/rules/cross-org-isolation.spec.ts",
      "tests/rules/offline-revocation-node.spec.ts",
    ],
    clientSources: [
      FIRESTORE_CLIENT_GATEWAY_FILES[1],
      FIRESTORE_CLIENT_GATEWAY_FILES[6],
    ],
    converterSources: ["settingsConverter"],
  },
  {
    id: "roster",
    path: "organizations/{orgId}/teams/{teamId}/roster/current",
    ruleMatch: "match /roster/{rosterId}",
    permissions: {
      read: teamReaders,
      create: teamManagers,
      update: teamManagers,
      delete: teamManagers,
    },
    conditions:
      "Only document ID current; canManageTeamData is required for every write.",
    evidence: [
      "tests/rules/membership-and-roles.spec.ts",
      "tests/rules/cross-org-isolation.spec.ts",
      "tests/rules/offline-revocation-node.spec.ts",
    ],
    clientSources: [
      FIRESTORE_CLIENT_GATEWAY_FILES[2],
      FIRESTORE_CLIENT_GATEWAY_FILES[6],
    ],
    converterSources: ["rosterConverter"],
  },
  {
    id: "games",
    path: "organizations/{orgId}/teams/{teamId}/games/{gameId}",
    ruleMatch: "match /games/{gameId}",
    permissions: {
      read: teamReaders,
      create: gameWriters,
      update: gameWriters,
      delete: [],
    },
    conditions:
      "Organization/team/path fields, revision, writer claim/epoch and affectedKeys are validated; hard delete is denied.",
    evidence: [
      "tests/rules/games-and-actions.spec.ts",
      "tests/rules/pilot-reads-writes-takeover.spec.ts",
      "tests/rules/cross-org-isolation.spec.ts",
    ],
    clientSources: [
      FIRESTORE_CLIENT_GATEWAY_FILES[3],
      FIRESTORE_CLIENT_GATEWAY_FILES[6],
    ],
    converterSources: ["gameConverter"],
  },
  {
    id: "game-actions",
    path: "organizations/{orgId}/teams/{teamId}/games/{gameId}/actions/{actionId}",
    ruleMatch: "match /actions/{actionId}",
    permissions: {
      read: teamReaders,
      create: gameWriters,
      update: [],
      delete: [],
    },
    conditions:
      "Create-only; document ID/clientActionId, writer uid/device/epoch, sequence and immutable payload are validated.",
    evidence: [
      "tests/rules/games-and-actions.spec.ts",
      "tests/rules/cross-org-isolation.spec.ts",
    ],
    clientSources: [FIRESTORE_CLIENT_GATEWAY_FILES[3]],
    converterSources: ["gameActionConverter"],
  },
  {
    id: "completed-games",
    path: "organizations/{orgId}/teams/{teamId}/completedGames/{completedGameId}",
    ruleMatch: "match /completedGames/{completedGameId}",
    permissions: {
      read: teamReaders,
      create: gameWriters,
      update: teamManagers,
      delete: [],
    },
    conditions:
      "Create-only immutable game payload; update is tombstone-only with revision/deletedBy checks; hard delete denied.",
    evidence: [
      "tests/rules/completed-games.spec.ts",
      "tests/rules/pilot-reads-writes-completed-games.spec.ts",
      "tests/rules/cross-org-isolation.spec.ts",
    ],
    clientSources: [
      FIRESTORE_CLIENT_GATEWAY_FILES[3],
      FIRESTORE_CLIENT_GATEWAY_FILES[4],
      FIRESTORE_CLIENT_GATEWAY_FILES[6],
      FIRESTORE_CLIENT_GATEWAY_FILES[7],
    ],
    converterSources: ["completedGameConverter"],
  },
  {
    id: "migration-runs",
    path: "organizations/{orgId}/teams/{teamId}/migrationRuns/{runId}",
    ruleMatch: "match /migrationRuns/{runId}",
    permissions: {
      read: teamReaders,
      create: teamManagers,
      update: teamManagers,
      delete: [],
    },
    conditions:
      "Target context, initiator, immutable manifest identity and monotone status/update fields are validated; " +
      "delete denied. No dedicated Firestore converter exists for this path: FirestoreCloudMigrationRunGateway.ts " +
      "reads/writes the manifest as a plain typed object without `.withConverter()`, so converterSources is " +
      "intentionally empty.",
    evidence: [
      "tests/rules/migration-runs.spec.ts",
      "tests/rules/cross-org-isolation.spec.ts",
    ],
    clientSources: [FIRESTORE_CLIENT_GATEWAY_FILES[5]],
    converterSources: [],
  },
  {
    id: "organization-members-collection-group",
    path: "{path=**}/organizationMembers/{uid}",
    ruleMatch: "match /{path=**}/organizationMembers/{uid}",
    permissions: {
      read: [
        "organizationOwner",
        "organizationAdmin",
        "coach",
        "scorer",
        "viewer",
      ],
      create: [],
      update: [],
      delete: [],
    },
    conditions:
      "Collection-group query must filter uid == auth.uid; only the caller own membership is readable.",
    evidence: ["tests/rules/context-switcher-query.spec.ts"],
    clientSources: [FIRESTORE_CLIENT_GATEWAY_FILES[0]],
    converterSources: ["organizationMemberConverter"],
  },
  {
    id: "team-members-collection-group",
    path: "{path=**}/teamMembers/{uid}",
    ruleMatch: "match /{path=**}/teamMembers/{uid}",
    permissions: {
      read: ["teamOnlyMember"],
      create: [],
      update: [],
      delete: [],
    },
    conditions:
      "Collection-group query must filter uid == auth.uid; only the caller own team memberships are readable.",
    evidence: ["tests/rules/team-context-switcher-query.spec.ts"],
    clientSources: [FIRESTORE_CLIENT_GATEWAY_FILES[0]],
    converterSources: ["teamMemberConverter"],
  },
] as const;
