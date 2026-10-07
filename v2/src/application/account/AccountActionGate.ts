import type {
  AccountAssessmentOutcome,
  AccountDeletionCoordinator,
  ClearFirestoreDataOutcome,
  DeleteAuthAccountOutcome,
} from './AccountDeletionCoordinator';
import type {
  LeaveOrganizationCoordinator,
  LeaveOrganizationOutcome,
} from './LeaveOrganizationCoordinator';
import type {
  CompleteTransferOutcome,
  OwnershipTransferCoordinator,
  PromoteOutcome,
  TransferCandidatesOutcome,
} from './OwnershipTransferCoordinator';

/**
 * PR 8.3c-2c-i (docs/pr-8.3c-2c-plan.md §2; reviewnit B op 2b-ii): één ingang en één
 * slot voor alle accountacties. `LeaveOrganizationCoordinator` en
 * `AccountDeletionCoordinator` hebben elk een eigen slot, dus zonder deze poort kon een
 * `leave()` gelijktijdig met een `clearFirestoreData()` lopen (beide schrijven deletes op
 * dezelfde eigen documenten en lezen elkaars tussenstanden als inventaris). Hier geldt:
 * zolang één actie loopt, geeft elke andere `in-progress` zonder dat een coördinator
 * wordt aangeroepen. Het slot wordt synchroon gezet, vóór de eerste `await`.
 *
 * PR 8.3c-2c-ii (docs/pr-8.3c-2c-plan.md §8): ook de overdracht loopt door dit slot.
 * `OwnershipTransferCoordinator` heeft alleen een slot over zijn eigen twee schrijfmethoden;
 * zonder deze poort kon een `completeTransfer()` naast een `leave()` of
 * `clearFirestoreData()` lopen. De read-only `listTransferCandidates()` zit er ook achter,
 * net als `assess()`.
 *
 * De poort bewaart niets en kent geen wachtwoord: dat gaat ongewijzigd als argument door.
 */
export interface AccountActionCoordinators {
  leaveCoordinator: Pick<LeaveOrganizationCoordinator, 'leave'>;
  accountDeletionCoordinator: Pick<
    AccountDeletionCoordinator,
    'assess' | 'clearFirestoreData' | 'deleteAuthAccount'
  >;
  ownershipTransferCoordinator: Pick<
    OwnershipTransferCoordinator,
    'listTransferCandidates' | 'promote' | 'completeTransfer'
  >;
}

type InProgress = { status: 'in-progress' };

export class AccountActionGate {
  private busy = false;

  constructor(private readonly coordinators: AccountActionCoordinators) {}

  /** `true` zolang een accountactie loopt (voor de UI: knoppen uit). */
  get isBusy(): boolean {
    return this.busy;
  }

  leave(organizationId: string): Promise<LeaveOrganizationOutcome> {
    return this.exclusive(() => this.coordinators.leaveCoordinator.leave(organizationId));
  }

  assess(): Promise<AccountAssessmentOutcome> {
    return this.exclusive(() => this.coordinators.accountDeletionCoordinator.assess());
  }

  clearFirestoreData(password: string): Promise<ClearFirestoreDataOutcome> {
    return this.exclusive(() =>
      this.coordinators.accountDeletionCoordinator.clearFirestoreData(password),
    );
  }

  deleteAuthAccount(password: string): Promise<DeleteAuthAccountOutcome> {
    return this.exclusive(() =>
      this.coordinators.accountDeletionCoordinator.deleteAuthAccount(password),
    );
  }

  listTransferCandidates(organizationId: string): Promise<TransferCandidatesOutcome | InProgress> {
    return this.exclusive(() =>
      this.coordinators.ownershipTransferCoordinator.listTransferCandidates(organizationId),
    );
  }

  promote(organizationId: string, targetUid: string): Promise<PromoteOutcome> {
    return this.exclusive(() =>
      this.coordinators.ownershipTransferCoordinator.promote(organizationId, targetUid),
    );
  }

  completeTransfer(
    organizationId: string,
    previousOwnerUid: string,
  ): Promise<CompleteTransferOutcome> {
    return this.exclusive(() =>
      this.coordinators.ownershipTransferCoordinator.completeTransfer(
        organizationId,
        previousOwnerUid,
      ),
    );
  }

  private async exclusive<T>(run: () => Promise<T>): Promise<T | InProgress> {
    if (this.busy) return { status: 'in-progress' };
    this.busy = true;
    try {
      return await run();
    } finally {
      this.busy = false;
    }
  }
}
