import type { Firestore } from 'firebase/firestore';
import type { AccountGateway } from '../../application/account/AccountGateway';
import type { LocalUnsyncedWorkProbe } from '../../application/account/LocalUnsyncedWorkProbe';
import { LeaveOrganizationCoordinator } from '../../application/account/LeaveOrganizationCoordinator';
import { FirestoreAccountGateway } from './FirestoreAccountGateway';
import { LocalStorageUnsyncedWorkProbe } from './LocalStorageUnsyncedWorkProbe';

export interface AccountServices {
  accountGateway: AccountGateway;
  leaveCoordinator: LeaveOrganizationCoordinator;
}

/**
 * PR 8.3c-2b-i (docs/pr-8.3c-2b-plan.md §C.1/§C.4): fabriek voor de account-diensten.
 * Heeft bewust GEEN `selectedContext` nodig — "organisatie verlaten" en (in 2b-ii)
 * accountverwijdering moeten ook werken voor iemand die geen context (meer) heeft of op
 * een onvertrouwd apparaat zit. De wiring op `AuthGate`-niveau is 2c; in dit stuk roept
 * nog niets deze fabriek aan.
 */
export function createAccountServices(
  db: Firestore,
  probe: LocalUnsyncedWorkProbe = new LocalStorageUnsyncedWorkProbe(),
): AccountServices {
  const accountGateway = new FirestoreAccountGateway(db);
  return {
    accountGateway,
    leaveCoordinator: new LeaveOrganizationCoordinator(accountGateway, probe),
  };
}
