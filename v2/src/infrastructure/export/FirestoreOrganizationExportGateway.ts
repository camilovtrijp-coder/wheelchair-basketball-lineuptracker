// Firestore-implementatie van OrganizationExportGateway (PR 8.3b,
// docs/pr-8.3-plan.md §C 8.3b werk 2). Leest UITSLUITEND — geen enkele write
// in dit bestand, zelfde harde grens als
// `FirestoreCloudMigrationInventoryGateway.ts`. Hergebruikt bestaande
// converters voor validatie; de conversie van Firestore `Timestamp`-velden
// naar platte ISO-strings (nodig omdat `domain/export/` geen Firebase-
// afhankelijkheid mag hebben) gebeurt generiek via `toExportRow()` hieronder
// i.p.v. per documenttype een aparte serialisatiefunctie te schrijven — elf
// gegevensfamilies, allemaal met verschillende (en soms optionele)
// Timestamp-velden, zouden anders elf bijna-identieke omzetters opleveren.
//
// Faalt in zijn geheel zodra één read/conversie ergens onderweg misgaat (een
// enkele `try`/`catch` rond de VOLLEDIGE `readOrganizationExportInput()`-body,
// geen losse per-familie foutafhandeling) — plan §C 8.3b acceptatie:
// "corrupte of deels onleesbare clouddata kan niet als geslaagde export
// eindigen". Er wordt hier nooit geschreven, dus "nul writes bij een fout"
// (plan werk 3) is voor deze laag triviaal waar.
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  type CollectionReference,
  type Firestore,
  type FirestoreDataConverter,
} from 'firebase/firestore';
import {
  completedGameConverter,
  gameActionConverter,
  gameConverter,
  invitationConverter,
  organizationConverter,
  organizationMemberConverter,
  rosterConverter,
  settingsConverter,
  teamConverter,
  teamMemberConverter,
} from 'firebase-base/documents';
import type {
  OrganizationExportGateway,
  OrganizationExportReadResult,
} from '../../application/export/OrganizationExportGateway';
import type { RawOrganizationExportTeam } from '../../domain/export/build';
import type { OrganizationExportRow } from '../../domain/export/types';

/**
 * Zet een converter-uitvoerobject (mag `Timestamp`-velden bevatten) om naar
 * platte, JSON-veilige waarden. `Timestamp`-instanties worden
 * `.toDate().toISOString()`; arrays en geneste objecten worden recursief
 * bezocht (bijv. `OrganizationMemberDocument.joinedAt`,
 * `CompletedGameDocument.deletedAt`, `GameDocument.updatedAt`,
 * `migrationRuns`' rauwe `updatedAt`-Timestamp). Alles anders
 * (string/number/boolean/null) blijft ongewijzigd.
 *
 * Herreview PR #87 (vervolg op P1): meerdere BESTAANDE, geldige converters
 * (`organizationMemberConverter.joinedAt`/`.invitationId`,
 * `invitationConverter.claimedAt`, `teamMemberConverter.addedAt`) leveren bij
 * een afwezig optioneel veld een object-property met de WAARDE `undefined`
 * op (niet: de key ontbreekt). `roundtrip.ts`'s `isJsonSafe()`-controle wijst
 * élke `undefined`-waarde af — terecht voor een écht corrupt veld, maar
 * zonder normalisatie hier wees het ook elke doodgewone export met een
 * afwezig optioneel veld af (reproduceerbaar: `{"converterKeys":["role",
 * "email","uid","joinedAt","invitationId"],"roundtripAccepted":false}`).
 * Object-properties met de waarde `undefined` worden hier daarom weggelaten
 * — dit is de infrastructure-grens, vóór `build.ts`/`roundtrip.ts` iets ziet,
 * dus dat blijft strikt (geen enkele `undefined` mag ooit een geldige
 * export bereiken). Array-ELEMENTEN met de waarde `undefined` worden bewust
 * WEL doorgegeven (`value.map(toJsonSafe)` hieronder verandert niets aan een
 * `undefined`-element) — dat is altijd een corrupt signaal (nooit een normaal
 * "afwezig optioneel veld"-patroon in een array) en moet dus `isJsonSafe()`
 * blijven laten falen, niet stilzwijgend naar `null` worden omgezet zoals
 * `JSON.stringify()` dat zou doen.
 */
export function toJsonSafe(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[key] = toJsonSafe(v);
    }
    return out;
  }
  return value;
}

export function toExportRow(id: string, data: Record<string, unknown>): OrganizationExportRow {
  return { id, ...(toJsonSafe(data) as Record<string, unknown>) };
}

export class FirestoreOrganizationExportGateway implements OrganizationExportGateway {
  constructor(private readonly db: Firestore) {}

  async readOrganizationExportInput(organizationId: string): Promise<OrganizationExportReadResult> {
    try {
      const orgRef = doc(this.db, 'organizations', organizationId).withConverter(
        organizationConverter,
      );
      const orgSnap = await getDoc(orgRef);
      if (!orgSnap.exists()) {
        return { ok: false, error: { code: 'organization-not-found' } };
      }
      const orgData = orgSnap.data();

      const organizationMembers = await this.readCollection(
        collection(this.db, 'organizations', organizationId, 'organizationMembers'),
        organizationMemberConverter,
      );
      const invitations = await this.readCollection(
        collection(this.db, 'organizations', organizationId, 'invitations'),
        invitationConverter,
      );
      const teamRows = await this.readCollection(
        collection(this.db, 'organizations', organizationId, 'teams'),
        teamConverter,
      );

      const teams: RawOrganizationExportTeam[] = [];
      for (const teamRow of teamRows) {
        teams.push(await this.readTeam(organizationId, teamRow.id as string, teamRow));
      }

      return {
        ok: true,
        data: {
          organization: {
            id: organizationId,
            name: orgData.name,
            createdBy: orgData.createdBy,
            createdAt: toJsonSafe(orgData.createdAt) as string,
          },
          organizationMembers,
          invitations,
          teams,
        },
      };
    } catch (error) {
      return { ok: false, error: { code: 'read-failed', detail: error } };
    }
  }

  private async readTeam(
    organizationId: string,
    teamId: string,
    teamRow: OrganizationExportRow,
  ): Promise<RawOrganizationExportTeam> {
    const teamPath = ['organizations', organizationId, 'teams', teamId] as const;

    const teamMembers = await this.readCollection(
      collection(this.db, ...teamPath, 'teamMembers'),
      teamMemberConverter,
    );

    const settingsSnap = await getDoc(
      doc(this.db, ...teamPath, 'settings', 'current').withConverter(settingsConverter),
    );
    const settings = settingsSnap.exists()
      ? toExportRow('current', settingsSnap.data() as unknown as Record<string, unknown>)
      : null;

    const rosterSnap = await getDoc(
      doc(this.db, ...teamPath, 'roster', 'current').withConverter(rosterConverter),
    );
    // Herreview PR #87 (P1): eerder werd hier alleen `.players` bewaard,
    // waardoor `updatedAt` en de documentidentiteit zelf stil uit de export
    // verdwenen. Volledige document, net als `settings` hierboven.
    const roster = rosterSnap.exists()
      ? toExportRow('current', rosterSnap.data() as unknown as Record<string, unknown>)
      : null;

    const gamesSnap = await getDocs(
      collection(this.db, ...teamPath, 'games').withConverter(gameConverter),
    );
    const games: (OrganizationExportRow & { actions: OrganizationExportRow[] })[] = [];
    for (const gameSnap of gamesSnap.docs) {
      const actions = await this.readCollection(
        collection(this.db, ...teamPath, 'games', gameSnap.id, 'actions'),
        gameActionConverter,
      );
      games.push({
        ...toExportRow(gameSnap.id, gameSnap.data() as unknown as Record<string, unknown>),
        actions,
      });
    }

    const completedGames = await this.readCollection(
      collection(this.db, ...teamPath, 'completedGames'),
      completedGameConverter,
    );

    const migrationRunsSnap = await getDocs(collection(this.db, ...teamPath, 'migrationRuns'));
    const migrationRuns = migrationRunsSnap.docs.map((snap) => toExportRow(snap.id, snap.data()));

    return {
      teamId,
      name: teamRow.name as string,
      orgName: teamRow.orgName as string,
      createdBy: teamRow.createdBy as string,
      createdAt: teamRow.createdAt as string,
      teamMembers,
      settings,
      roster,
      games,
      completedGames,
      migrationRuns,
    };
  }

  /** Leest een hele collectie via de gegeven converter en levert platte,
   * JSON-veilige rijen op (`id` + de gevalideerde, Timestamp-vrije velden).
   * `T` is een `firebase-base/documents`-converterinterface (bijv.
   * `OrganizationMemberDocument`) — die dragen bewust geen indexsignature
   * (elk veld is expliciet getypeerd), dus de cast naar `Record<string,
   * unknown>` hierbinnen is puur om `toExportRow()`'s generieke
   * JSON-serialisatie aan te kunnen roepen; de converter zelf heeft de
   * shape al afgedwongen vóórdat we hier komen. */
  private async readCollection<T>(
    collectionRef: CollectionReference,
    converter: FirestoreDataConverter<T>,
  ): Promise<OrganizationExportRow[]> {
    const snap = await getDocs(collectionRef.withConverter(converter));
    return snap.docs.map((d) => toExportRow(d.id, d.data() as Record<string, unknown>));
  }
}
