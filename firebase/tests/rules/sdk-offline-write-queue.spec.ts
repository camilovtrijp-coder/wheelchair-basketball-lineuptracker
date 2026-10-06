// SDK-aanname achter `FirestoreGameCloudGateway.uploadActions()` (v2): een
// `setDoc()` die offline niet bevestigt, blijft in Firestores lokale
// schrijfwachtrij staan en is daarna cache-only leesbaar (`getDocFromCache`)
// met `metadata.hasPendingWrites === true` en de eigen data; een cache-miss
// geeft een fout; na de reconnect verdwijnt de wachtende-write-vlag. De v2-gateway
// verstuurt een action daarom niet opnieuw zolang dezelfde payload zo in de
// wachtrij staat (anders groeit de wachtrij bij een lange offline wedstrijd met
// dubbele creates). Deze test bewijst die aanname tegen de echte SDK en emulator,
// met een pad dat de Rules toestaan zodat er na de reconnect niets wordt geweigerd.

import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  disableNetwork,
  doc,
  enableNetwork,
  getDocFromCache,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, authCtx } from './helpers/testEnv.js';
import { USERS } from './helpers/fixtures.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
  await env.clearFirestore();
});
afterAll(async () => {
  await env.cleanup();
});

describe('Firestore SDK: offline schrijfwachtrij en cache-only lezen', () => {
  it('cache-miss, wachtende write zichtbaar met hasPendingWrites, en na reconnect bevestigd', async () => {
    const db = authCtx(env, USERS.grace.uid, {
      email: USERS.grace.email,
      email_verified: true,
    });
    const ref = doc(db, 'organizations', 'org-sdk-wachtrij');

    // 1. Nog nooit gezien: een cache-miss is een fout (geen hang, geen netwerk).
    await expect(getDocFromCache(ref)).rejects.toMatchObject({ code: 'unavailable' });

    // 2. Offline: de write bevestigt niet, maar staat lokaal leesbaar in de wachtrij.
    await disableNetwork(db);
    const write = setDoc(ref, {
      name: 'Wachtrij (fictief)',
      createdBy: USERS.grace.uid,
      createdAt: serverTimestamp(),
    });
    const queued = await getDocFromCache(ref);
    expect(queued.exists()).toBe(true);
    expect(queued.metadata.hasPendingWrites).toBe(true);
    expect(queued.data({ serverTimestamps: 'estimate' })).toMatchObject({
      name: 'Wachtrij (fictief)',
      createdBy: USERS.grace.uid,
    });

    // 3. Reconnect: de wachtrij wordt afgeleverd en de vlag verdwijnt.
    await enableNetwork(db);
    await write;
    const confirmed = await getDocFromCache(ref);
    expect(confirmed.exists()).toBe(true);
    expect(confirmed.metadata.hasPendingWrites).toBe(false);
  });

  it('een offline write die de Rules weigeren verdwijnt na de reconnect uit de lokale weergave (geen vals "bevestigd")', async () => {
    const db = authCtx(env, USERS.henry.uid, {
      email: USERS.henry.email,
      email_verified: true,
    });
    // Niet toegestaan: een organisatie aanmaken met een ander uid als `createdBy`.
    const ref = doc(db, 'organizations', 'org-sdk-geweigerd');
    await disableNetwork(db);
    const write = setDoc(ref, {
      name: 'Geweigerd (fictief)',
      createdBy: USERS.grace.uid,
      createdAt: serverTimestamp(),
    });
    const rejected = write.then(
      () => 'accepted',
      (error: { code?: string }) => error.code ?? 'rejected',
    );
    const queued = await getDocFromCache(ref);
    expect(queued.metadata.hasPendingWrites).toBe(true);

    await enableNetwork(db);
    expect(await rejected).toBe('permission-denied');

    // De lokale laag is teruggedraaid: een cache-miss, geen document zonder wachtende write.
    await expect(getDocFromCache(ref)).rejects.toMatchObject({ code: 'unavailable' });
  });
});
