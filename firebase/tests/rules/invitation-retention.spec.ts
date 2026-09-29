// PR 8.3c-1 — bewaartermijn en opruiming van uitnodigingen
// (docs/pr-8.3c-besluitvoorstel.md §3.4).
//
// Een uitnodiging is vrijwel volledig een persoonsgegeven (het e-mailadres) en
// was tot nu toe onverwijderbaar. Dit bestand bewijst:
//
//  1. acceptatietermijn: accepteren kan alleen binnen 30 dagen na `invitedAt`;
//  2. `revokedAt`: de intrekpatch schrijft een servergebonden eindtijdstempel;
//  3. owner/admin-delete: alle vier de statussen, elk gemeten aan zijn EIGEN
//     tijdstempel met 30 dagen ondergrens, incl. terugval op `invitedAt`;
//  4. self-delete: de uitgenodigde zelf, geen ondergrens, `email_verified` vereist;
//  5. het querycontract `collectionGroup('invitations').where('email','==',eigen)`.

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, assertSucceeds, assertFails, authCtx, unauthCtx, withAdmin } from './helpers/testEnv.js';
import { ORG_A, ORG_B, USERS } from './helpers/fixtures.js';
import { CLAIMS, dagenGeleden, seedOrganizations } from './helpers/retention.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await seedOrganizations(env);
});

type Status = 'pending' | 'accepted' | 'claimed' | 'revoked';
const INV = 'inv-8-3-c-1';

function invRef(db: ReturnType<typeof authCtx>, orgId = ORG_A, id = INV) {
  return doc(db, 'organizations', orgId, 'invitations', id);
}
function aliceDb() {
  return authCtx(env, USERS.alice.uid, CLAIMS.alice);
}
function bobDb() {
  return authCtx(env, USERS.bob.uid, CLAIMS.bob);
}
function graceDb(claims: Record<string, unknown> = CLAIMS.grace) {
  return authCtx(env, USERS.grace.uid, claims);
}

interface SeedOptions {
  status: Status;
  invitedDagen?: number;
  acceptedDagen?: number | null;
  claimedDagen?: number | null;
  revokedDagen?: number | null;
  orgId?: string;
  id?: string;
  email?: string;
  role?: string;
}

/** Seedt via Admin (omzeilt Rules) een uitnodiging met precies de gevraagde tijdstempels. */
async function seed(o: SeedOptions) {
  const data: Record<string, unknown> = {
    email: o.email ?? USERS.grace.email,
    role: o.role ?? 'viewer',
    status: o.status,
    invitedBy: USERS.alice.uid,
    invitedAt: dagenGeleden(o.invitedDagen ?? 1),
    acceptedAt: o.acceptedDagen == null ? null : dagenGeleden(o.acceptedDagen),
  };
  if (o.claimedDagen != null) data.claimedAt = dagenGeleden(o.claimedDagen);
  if (o.revokedDagen != null) data.revokedAt = dagenGeleden(o.revokedDagen);
  await withAdmin(env, async (db) => {
    await db
      .collection('organizations')
      .doc(o.orgId ?? ORG_A)
      .collection('invitations')
      .doc(o.id ?? INV)
      .set(data);
  });
}

describe('acceptatietermijn van 30 dagen', () => {
  it('accepteren slaagt binnen 30 dagen (uitnodiging van 29 dagen oud)', async () => {
    await seed({ status: 'pending', invitedDagen: 29 });
    await assertSucceeds(updateDoc(invRef(graceDb()), { status: 'accepted', acceptedAt: serverTimestamp() }));
  });

  it('accepteren wordt geweigerd na 30 dagen (uitnodiging van 31 dagen oud)', async () => {
    await seed({ status: 'pending', invitedDagen: 31 });
    await assertFails(updateDoc(invRef(graceDb()), { status: 'accepted', acceptedAt: serverTimestamp() }));
  });

  it('een uitnodiging uit lang geleden (2 jaar) is niet meer inwisselbaar', async () => {
    await seed({ status: 'pending', invitedDagen: 730 });
    await assertFails(updateDoc(invRef(graceDb()), { status: 'accepted', acceptedAt: serverTimestamp() }));
  });
});

describe('intrekken schrijft een servergebonden revokedAt', () => {
  it('owner en admin mogen intrekken met revokedAt == request.time', async () => {
    await seed({ status: 'pending' });
    await assertSucceeds(updateDoc(invRef(aliceDb()), { status: 'revoked', revokedAt: serverTimestamp() }));
    await seed({ status: 'pending' });
    await assertSucceeds(updateDoc(invRef(bobDb()), { status: 'revoked', revokedAt: serverTimestamp() }));
  });

  it('weigert intrekken ZONDER revokedAt (het eindtijdstempel is verplicht geworden)', async () => {
    await seed({ status: 'pending' });
    await assertFails(updateDoc(invRef(aliceDb()), { status: 'revoked' }));
  });

  it.each([
    ['een clientgekozen string', '2026-01-01T00:00:00.000Z'],
    ['een teruggedateerd tijdstempel', Timestamp.fromMillis(Date.now() - 60 * 86_400_000)],
    ['een toekomstig tijdstempel', Timestamp.fromMillis(Date.now() + 3_600_000)],
    ['null', null],
  ])('weigert revokedAt als %s', async (_naam, waarde) => {
    await seed({ status: 'pending' });
    await assertFails(updateDoc(invRef(aliceDb()), { status: 'revoked', revokedAt: waarde }));
  });

  it('weigert intrekken dat een ander veld meestuurt', async () => {
    await seed({ status: 'pending' });
    await assertFails(
      updateDoc(invRef(aliceDb()), { status: 'revoked', revokedAt: serverTimestamp(), role: 'organizationOwner' }),
    );
    await assertFails(
      updateDoc(invRef(aliceDb()), { status: 'revoked', revokedAt: serverTimestamp(), email: 'ander@example.test' }),
    );
  });

  it.each([
    ['carol (coach)', USERS.carol.uid, CLAIMS.carol],
    ['erin (viewer)', USERS.erin.uid, CLAIMS.erin],
    ['frank (cross-org)', USERS.frank.uid, CLAIMS.frank],
    ['grace (de uitgenodigde zelf)', USERS.grace.uid, CLAIMS.grace],
  ])('%s mag NIET intrekken', async (_naam, uid, claims) => {
    await seed({ status: 'pending' });
    await assertFails(
      updateDoc(invRef(authCtx(env, uid, claims)), { status: 'revoked', revokedAt: serverTimestamp() }),
    );
  });
});

describe('owner/admin-delete: 30 dagen ondergrens, per status aan het EIGEN tijdstempel', () => {
  const GEVALLEN: {
    naam: string;
    oud: SeedOptions;
    jong: SeedOptions;
  }[] = [
    {
      naam: 'pending (invitedAt)',
      oud: { status: 'pending', invitedDagen: 31 },
      jong: { status: 'pending', invitedDagen: 29 },
    },
    {
      naam: 'accepted (acceptedAt — vastgelopen tussenstand)',
      oud: { status: 'accepted', invitedDagen: 40, acceptedDagen: 31 },
      jong: { status: 'accepted', invitedDagen: 40, acceptedDagen: 29 },
    },
    {
      naam: 'claimed (claimedAt)',
      oud: { status: 'claimed', invitedDagen: 50, acceptedDagen: 45, claimedDagen: 31 },
      jong: { status: 'claimed', invitedDagen: 50, acceptedDagen: 45, claimedDagen: 29 },
    },
    {
      naam: 'revoked (revokedAt)',
      oud: { status: 'revoked', invitedDagen: 50, revokedDagen: 31 },
      jong: { status: 'revoked', invitedDagen: 50, revokedDagen: 29 },
    },
  ];

  for (const gevallen of GEVALLEN) {
    it(`owner mag een ${gevallen.naam} van 31 dagen oud verwijderen`, async () => {
      await seed(gevallen.oud);
      await assertSucceeds(deleteDoc(invRef(aliceDb())));
    });

    it(`admin mag een ${gevallen.naam} van 31 dagen oud verwijderen`, async () => {
      await seed(gevallen.oud);
      await assertSucceeds(deleteDoc(invRef(bobDb())));
    });

    it(`owner mag een ${gevallen.naam} van 29 dagen oud NIET verwijderen`, async () => {
      await seed(gevallen.jong);
      await assertFails(deleteDoc(invRef(aliceDb())));
    });
  }

  it('meet aan het tijdstempel van de HUIDIGE status, niet aan invitedAt: een oud aangemaakte maar net geclaimde uitnodiging is nog niet verwijderbaar', async () => {
    await seed({ status: 'claimed', invitedDagen: 200, acceptedDagen: 5, claimedDagen: 2 });
    await assertFails(deleteDoc(invRef(aliceDb())));
  });

  it('een net ingetrokken oude uitnodiging is niet verwijderbaar (revokedAt telt, invitedAt niet)', async () => {
    await seed({ status: 'revoked', invitedDagen: 200, revokedDagen: 1 });
    await assertFails(deleteDoc(invRef(aliceDb())));
  });

  it('een verlopen pending uitnodiging (die niemand meer kan accepteren) is opruimbaar', async () => {
    await seed({ status: 'pending', invitedDagen: 90 });
    await assertFails(updateDoc(invRef(graceDb()), { status: 'accepted', acceptedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(invRef(aliceDb())));
  });

  it('terugval op invitedAt: een geclaimde uitnodiging ZONDER claimedAt (pre-8.3c-1 document) van 31 dagen is verwijderbaar, geen evaluatiefout', async () => {
    await seed({ status: 'claimed', invitedDagen: 31 });
    await assertSucceeds(deleteDoc(invRef(aliceDb())));
  });

  it('terugval op invitedAt: een ingetrokken uitnodiging ZONDER revokedAt (legacy) van 31 dagen is verwijderbaar', async () => {
    await seed({ status: 'revoked', invitedDagen: 31 });
    await assertSucceeds(deleteDoc(invRef(aliceDb())));
  });

  it('terugval op invitedAt: een geaccepteerde uitnodiging met acceptedAt == null (inconsistent document) valt terug op invitedAt', async () => {
    await seed({ status: 'accepted', invitedDagen: 31, acceptedDagen: null });
    await assertSucceeds(deleteDoc(invRef(aliceDb())));
  });

  it('terugval is niet omzeilbaar naar jong: een verse uitnodiging zonder extra tijdstempels blijft beschermd', async () => {
    await seed({ status: 'claimed', invitedDagen: 3 });
    await assertFails(deleteDoc(invRef(aliceDb())));
  });

  it.each([
    ['carol (coach)', USERS.carol.uid, CLAIMS.carol],
    ['dave (scorer)', USERS.dave.uid, CLAIMS.dave],
    ['erin (viewer)', USERS.erin.uid, CLAIMS.erin],
    ['henry (team-only coach)', USERS.henry.uid, CLAIMS.henry],
  ])('%s mag een verlopen uitnodiging van iemand anders NIET verwijderen', async (_naam, uid, claims) => {
    await seed({ status: 'pending', invitedDagen: 90 });
    await assertFails(deleteDoc(invRef(authCtx(env, uid, claims))));
  });

  it('cross-org: owner van organisatie B mag een verlopen uitnodiging van A NIET verwijderen', async () => {
    await seed({ status: 'pending', invitedDagen: 90 });
    await assertFails(deleteDoc(invRef(authCtx(env, USERS.frank.uid, CLAIMS.frank))));
  });

  it('een niet-ingelogde gebruiker mag niet verwijderen', async () => {
    await seed({ status: 'pending', invitedDagen: 90 });
    await assertFails(deleteDoc(invRef(unauthCtx(env))));
  });
});

describe('self-delete: de uitgenodigde zelf, GEEN ondergrens', () => {
  for (const status of ['pending', 'accepted', 'claimed', 'revoked'] as const) {
    it(`grace mag haar eigen JONGE (0 dagen) ${status}-uitnodiging verwijderen`, async () => {
      await seed({
        status,
        invitedDagen: 0,
        acceptedDagen: status === 'accepted' || status === 'claimed' ? 0 : null,
        claimedDagen: status === 'claimed' ? 0 : null,
        revokedDagen: status === 'revoked' ? 0 : null,
      });
      await assertSucceeds(deleteDoc(invRef(graceDb())));
    });
  }

  it('grace mag ook een OUDE uitnodiging van zichzelf verwijderen', async () => {
    await seed({ status: 'pending', invitedDagen: 400 });
    await assertSucceeds(deleteDoc(invRef(graceDb())));
  });

  it('vereist een geverifieerd e-mailadres: een ongeverifieerde token wordt geweigerd', async () => {
    await seed({ status: 'pending', invitedDagen: 1 });
    await assertFails(deleteDoc(invRef(graceDb({ email: USERS.grace.email, email_verified: false }))));
  });

  it('weigert een token zonder email_verified-claim', async () => {
    await seed({ status: 'pending', invitedDagen: 1 });
    await assertFails(deleteDoc(invRef(graceDb({ email: USERS.grace.email }))));
  });

  it('een ander e-mailadres mag andermans uitnodiging NIET verwijderen, ook niet als geverifieerd', async () => {
    await seed({ status: 'pending', invitedDagen: 400 });
    await assertFails(deleteDoc(invRef(authCtx(env, USERS.henry.uid, CLAIMS.henry))));
    await assertFails(deleteDoc(invRef(authCtx(env, USERS.frank.uid, CLAIMS.frank))));
  });

  it('e-mailvergelijking is exact: een afwijkende hoofdlettervariant telt niet als eigenaar', async () => {
    await seed({ status: 'pending', invitedDagen: 1 });
    await assertFails(
      deleteDoc(
        invRef(graceDb({ email: USERS.grace.email.toUpperCase(), email_verified: true })),
      ),
    );
  });

  it('bij het verwijderen van de eigen uitnodiging blijft het membership-spoor bestaan (autorisatiespoor blijft)', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('organizationMembers')
        .doc(USERS.grace.uid)
        .set({
          role: 'viewer',
          email: USERS.grace.email,
          uid: USERS.grace.uid,
          invitationId: INV,
        });
    });
    await seed({ status: 'claimed', invitedDagen: 2, acceptedDagen: 2, claimedDagen: 2 });
    await assertSucceeds(deleteDoc(invRef(graceDb())));
    const lid = await withAdmin(env, async (db) =>
      db
        .collection('organizations')
        .doc(ORG_A)
        .collection('organizationMembers')
        .doc(USERS.grace.uid)
        .get(),
    );
    if (!lid.exists) throw new Error('membership-document had moeten blijven bestaan');
  });
});

describe('collectionGroup-querycontract: invitations.email == eigen e-mailadres', () => {
  async function seedMeerdere() {
    await seed({ status: 'pending', invitedDagen: 1, id: 'inv-grace-a' });
    await seed({ status: 'revoked', invitedDagen: 50, revokedDagen: 45, id: 'inv-grace-b', orgId: ORG_B });
    await seed({ status: 'pending', invitedDagen: 1, id: 'inv-henry', email: USERS.henry.email });
  }

  function mijnUitnodigingen(db: ReturnType<typeof authCtx>, email: string) {
    return getDocs(query(collectionGroup(db, 'invitations'), where('email', '==', email)));
  }

  it('grace vindt haar eigen uitnodigingen in BEIDE organisaties, ook zonder lidmaatschap', async () => {
    await seedMeerdere();
    const snap = await assertSucceeds(mijnUitnodigingen(graceDb(), USERS.grace.email));
    const ids = snap.docs.map((d) => d.id).sort();
    if (JSON.stringify(ids) !== JSON.stringify(['inv-grace-a', 'inv-grace-b'])) {
      throw new Error(`onverwachte resultaten: ${JSON.stringify(ids)}`);
    }
  });

  it('weigert de query met het e-mailadres van een ANDER', async () => {
    await seedMeerdere();
    await assertFails(mijnUitnodigingen(graceDb(), USERS.henry.email));
  });

  it('weigert de query zonder e-mailfilter (ongefilterde collectionGroup-list)', async () => {
    await seedMeerdere();
    await assertFails(getDocs(collectionGroup(graceDb(), 'invitations')));
  });

  it('weigert de query met een ongeverifieerd e-mailadres', async () => {
    await seedMeerdere();
    await assertFails(
      mijnUitnodigingen(graceDb({ email: USERS.grace.email, email_verified: false }), USERS.grace.email),
    );
  });

  it('weigert de query voor een niet-ingelogde gebruiker', async () => {
    await seedMeerdere();
    await assertFails(mijnUitnodigingen(unauthCtx(env), USERS.grace.email));
  });

  it('geeft een organisatie-owner via de collectionGroup GEEN leesrecht op andermans adres (alleen de eigen e-mailclaim telt)', async () => {
    await seedMeerdere();
    await assertFails(mijnUitnodigingen(aliceDb(), USERS.grace.email));
  });

  it('een collectionGroup-query op andere collecties blijft verboden (geen verbreding voorbij invitations)', async () => {
    await seedMeerdere();
    await assertFails(getDocs(collectionGroup(graceDb(), 'invitationsExtra')));
    await assertFails(getDocs(collectionGroup(graceDb(), 'deletionRequests')));
  });

  it('de directe per-document-leesregel is ongewijzigd: grace leest haar eigen document, henry niet', async () => {
    await seed({ status: 'pending', invitedDagen: 1 });
    await assertSucceeds(getDoc(invRef(graceDb())));
    await assertFails(getDoc(invRef(authCtx(env, USERS.henry.uid, CLAIMS.henry))));
  });

  it('vindt-en-verwijdert einde-tot-einde: de resultaten van de query zijn zelf verwijderbaar voor de eigenaar van het adres', async () => {
    await seedMeerdere();
    const db = graceDb();
    const snap = await assertSucceeds(mijnUitnodigingen(db, USERS.grace.email));
    for (const d of snap.docs) {
      await assertSucceeds(deleteDoc(d.ref));
    }
    const na = await assertSucceeds(mijnUitnodigingen(db, USERS.grace.email));
    if (na.size !== 0) throw new Error('er staan nog uitnodigingen na het opruimen');
  });

  it('een NIET-eigen uitnodiging gevonden via een directe get blijft onverwijderbaar voor een andere verifieerde gebruiker', async () => {
    await seedMeerdere();
    await assertFails(
      deleteDoc(
        doc(authCtx(env, USERS.henry.uid, CLAIMS.henry), 'organizations', ORG_A, 'invitations', 'inv-grace-a'),
      ),
    );
  });
});
