import {
  classifyOrganizationForLeave,
  countOtherOwners,
  groupInventoryByOrganization,
  isSelfResolvable,
} from './classify';
import type { AccountInventory, OrganizationFacts, OrganizationLeaveClass } from './types';

/**
 * PR 8.3c-2b-ii (docs/pr-8.3c-2b-plan.md §B.9 stap 3, §C.2): het per-organisatieplan
 * voor accountverwijdering. Puur: geen I/O, geen Firebase; alles komt binnen als
 * argument, zodat elke klasse en `canProceed` met vaste, handmatig narekenbare invoer te
 * testen is.
 */
export interface AccountDeletionPlanEntry {
  organizationId: string;
  class: OrganizationLeaveClass;
  /** Alleen bij `owner-sole`/`owner-awaiting-removal`: aantal ANDERE owners. */
  otherOwnerCount?: number;
  /** Alleen bij `local-unsynced-work`: de telling van de probe. */
  localUnsyncedWork?: number;
}

export interface AccountDeletionPlan {
  /** Eén regel per organisatie waarin de gebruiker een eigen document heeft, in inventarisvolgorde. */
  organizations: AccountDeletionPlanEntry[];
  /** Alle eigen uitnodigingen, elke status: bij accountverwijdering gaan ze allemaal weg (§B.9 stap 5). */
  invitationCount: number;
  /**
   * `true` alleen als ELKE organisatie zelf op te lossen is. Anders volgt er geen enkele
   * write (poort vóór de eerste write, §B.9 stap 3): de gebruiker zou anders toegang tot
   * de oplosbare organisaties verliezen terwijl zijn account blijft bestaan.
   */
  canProceed: boolean;
}

export function buildAccountDeletionPlan(input: {
  callerUid: string;
  inventory: AccountInventory;
  /** Feiten per organisatie met een eigen membership; ontbreekt → fail closed (`organization-unsupported`). */
  factsByOrganization: ReadonlyMap<string, OrganizationFacts>;
  /** Telling van de lokale-werkprobe per organisatie; ontbreekt → 0. */
  localUnsyncedWorkByOrganization: ReadonlyMap<string, number>;
}): AccountDeletionPlan {
  const organizations: AccountDeletionPlanEntry[] = [];
  for (const slice of groupInventoryByOrganization(input.inventory).values()) {
    const facts = input.factsByOrganization.get(slice.organizationId) ?? null;
    const localUnsyncedWork = input.localUnsyncedWorkByOrganization.get(slice.organizationId) ?? 0;
    const organizationClass = classifyOrganizationForLeave({
      callerUid: input.callerUid,
      slice,
      facts,
      localUnsyncedWork,
    });
    const entry: AccountDeletionPlanEntry = {
      organizationId: slice.organizationId,
      class: organizationClass,
    };
    if (organizationClass === 'owner-sole' || organizationClass === 'owner-awaiting-removal') {
      entry.otherOwnerCount = facts === null ? 0 : countOtherOwners(facts, input.callerUid);
    }
    if (organizationClass === 'local-unsynced-work') entry.localUnsyncedWork = localUnsyncedWork;
    organizations.push(entry);
  }
  return {
    organizations,
    invitationCount: input.inventory.invitations.length,
    canProceed: organizations.every((entry) => isSelfResolvable(entry.class)),
  };
}
