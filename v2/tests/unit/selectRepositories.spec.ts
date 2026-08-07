import { describe, it, expect, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { selectRepositories } from '../../src/infrastructure/repositories/selectRepositories';
import type { AuthUser } from '../../src/domain/auth/types';
import type { SelectedContext } from '../../src/domain/organizations/types';

// FakeFirestore volstaat als dummy — de selectiefunctie geeft de Firestore-instantie
// door aan de adapters; zolang de adapters gewoon geïnitialiseerd worden (constructor
// slaat alleen op) is de inhoud irrelevant. Het gaat hier om de keuze, niet om I/O.
function fakeDb(): Firestore {
  return {} as Firestore;
}

const user: AuthUser = { uid: 'uid-1', email: 'a@example.test', emailVerified: true };
const context: SelectedContext = { orgId: 'org-1', teamId: 'team-1' };

describe('infrastructure/repositories/selectRepositories', () => {
  it('kiest localStorage-modus zonder authUser', () => {
    const out = selectRepositories({
      authUser: null,
      selectedContext: context,
      trustedDevice: true,
      firestoreDb: fakeDb(),
    });
    expect(out.kind).toBe('local');
  });

  it('kiest localStorage-modus zonder selectedContext', () => {
    const out = selectRepositories({
      authUser: user,
      selectedContext: null,
      trustedDevice: true,
      firestoreDb: fakeDb(),
    });
    expect(out.kind).toBe('local');
  });

  it('kiest localStorage-modus zonder trustedDevice', () => {
    const out = selectRepositories({
      authUser: user,
      selectedContext: context,
      trustedDevice: false,
      firestoreDb: fakeDb(),
    });
    expect(out.kind).toBe('local');
  });

  it('kiest cloud-modus bij authUser + selectedContext + trustedDevice', () => {
    const out = selectRepositories({
      authUser: user,
      selectedContext: context,
      trustedDevice: true,
      firestoreDb: fakeDb(),
    });
    expect(out.kind).toBe('cloud');
    if (out.kind === 'cloud') {
      expect(out.settings).toBeDefined();
      expect(out.roster).toBeDefined();
    }
  });

  it(
    'REGRESSIE: keuze wisselt NIET bij online/offline-toggle binnen dezelfde sessie ' +
      '(architectuurfix uit docs/pr-5.3-plan.md §C/5.3a punt 1)',
    () => {
      // De functie heeft bewust geen `online`-parameter. Een online/offline-toggle
      // mag de adapterkeuze dus niet veranderen — anders zou een cloud-only team
      // (geen v1-localStorage-data) bij offline plotseling een lege of verouderde
      // dataset zien en de #27-garantie ondermijnen.
      const before = selectRepositories({
        authUser: user,
        selectedContext: context,
        trustedDevice: true,
        firestoreDb: fakeDb(),
      });
      const after = selectRepositories({
        authUser: user,
        selectedContext: context,
        trustedDevice: true,
        firestoreDb: fakeDb(),
      });
      expect(before.kind).toBe(after.kind);
      expect(before.kind).toBe('cloud');
    },
  );

  it('instantieert elke keer een verse FirestoreSettings/RosterRepository (geen gedeelde cache op instantie-niveau)', () => {
    // Twee opeenvolgende cloud-keuzes mogen NIET dezelfde adapter-instantie
    // teruggeven — anders deelt een tweede context onbedoeld de IndexedDB-cache
    // van de eerste. De Firestore-DB-instantie wordt gedeeld (één client), maar
    // de adapters per context zijn vers.
    const a = selectRepositories({
      authUser: user,
      selectedContext: context,
      trustedDevice: true,
      firestoreDb: fakeDb(),
    });
    const b = selectRepositories({
      authUser: user,
      selectedContext: context,
      trustedDevice: true,
      firestoreDb: fakeDb(),
    });
    if (a.kind === 'cloud' && b.kind === 'cloud') {
      expect(a.settings).not.toBe(b.settings);
      expect(a.roster).not.toBe(b.roster);
    } else {
      throw new Error('Beide selecties moeten cloud zijn');
    }
  });
});

// Bewust geen import van vi hierboven — vi wordt enkel gebruikt voor spy-asserts in
// de Firestore*-specs; deze selectie-test is puur logica zonder firebase-I/O.
void vi;
