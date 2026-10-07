import type { Firestore } from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';
import type { AccountAuthGateway } from '../../application/account/AccountAuthGateway';
import { AccountDeletionCoordinator } from '../../application/account/AccountDeletionCoordinator';
import type { AccountGateway } from '../../application/account/AccountGateway';
import type { LocalUnsyncedWorkProbe } from '../../application/account/LocalUnsyncedWorkProbe';
import { LeaveOrganizationCoordinator } from '../../application/account/LeaveOrganizationCoordinator';
import { OwnershipTransferCoordinator } from '../../application/account/OwnershipTransferCoordinator';
import type { OwnershipTransferGateway } from '../../application/account/OwnershipTransferGateway';
import { FirebaseAccountAuthGateway } from '../auth/FirebaseAccountAuthGateway';
import { FirestoreAccountGateway } from './FirestoreAccountGateway';
import { FirestoreOwnershipTransferGateway } from './FirestoreOwnershipTransferGateway';
import { LocalStorageUnsyncedWorkProbe } from './LocalStorageUnsyncedWorkProbe';

export interface AccountServices {
  accountGateway: AccountGateway;
  accountAuthGateway: AccountAuthGateway;
  leaveCoordinator: LeaveOrganizationCoordinator;
  accountDeletionCoordinator: AccountDeletionCoordinator;
  ownershipTransferGateway: OwnershipTransferGateway;
  ownershipTransferCoordinator: OwnershipTransferCoordinator;
}

/**
 * PR 8.3c-2b-i/ii/iii (docs/pr-8.3c-2b-plan.md §C.1–§C.4): fabriek voor de
 * account-diensten. Heeft bewust GEEN `selectedContext` nodig — "organisatie verlaten" en
 * accountverwijdering moeten ook werken voor iemand die geen context (meer) heeft of op
 * een onvertrouwd apparaat zit. De wiring op `AuthGate`-niveau is 2c; nog niets roept
 * deze fabriek aan.
 *
 * `auth` MOET de Auth-instantie van dezelfde app als `db` zijn: `FirestoreAccountGateway`
 * leest de identiteit uit `getAuth(db.app)`, en reauthenticatie/`deleteUser` moeten
 * precies dat account raken. Een andere instantie wordt geweigerd.
 */
export function createAccountServices(
  db: Firestore,
  auth: Auth = getAuth(db.app),
  probe: LocalUnsyncedWorkProbe = new LocalStorageUnsyncedWorkProbe(),
): AccountServices {
  if (auth !== getAuth(db.app)) {
    throw new Error('createAccountServices: auth hoort niet bij de app van db');
  }
  const accountGateway = new FirestoreAccountGateway(db);
  const accountAuthGateway = new FirebaseAccountAuthGateway(auth);
  const ownershipTransferGateway = new FirestoreOwnershipTransferGateway(db);
  return {
    accountGateway,
    accountAuthGateway,
    leaveCoordinator: new LeaveOrganizationCoordinator(accountGateway, probe),
    accountDeletionCoordinator: new AccountDeletionCoordinator(
      accountGateway,
      accountAuthGateway,
      probe,
    ),
    ownershipTransferGateway,
    ownershipTransferCoordinator: new OwnershipTransferCoordinator(ownershipTransferGateway),
  };
}
