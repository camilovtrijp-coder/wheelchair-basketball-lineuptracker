// PR 8.3a: parentdocumenten mogen geen verweesde subcollecties veroorzaken en
// hun identity-/auditvelden mogen niet via een brede update worden herschreven.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  assertFails,
  assertSucceeds,
  authCtx,
  createTestEnv,
  withAdmin,
} from "./helpers/testEnv.js";
import { ORG_A, TEAM_A1, USERS } from "./helpers/fixtures.js";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    await db
      .collection("organizations")
      .doc(ORG_A)
      .set({
        name: "Org A",
        createdBy: USERS.alice.uid,
        createdAt: new Date("2026-08-31T10:00:00.000Z"),
      });
    await db
      .collection("organizations")
      .doc(ORG_A)
      .collection("organizationMembers")
      .doc(USERS.alice.uid)
      .set({
        role: "organizationOwner",
        email: USERS.alice.email,
        uid: USERS.alice.uid,
      });
    await db
      .collection("organizations")
      .doc(ORG_A)
      .collection("organizationMembers")
      .doc(USERS.bob.uid)
      .set({
        role: "organizationAdmin",
        email: USERS.bob.email,
        uid: USERS.bob.uid,
      });
    await db
      .collection("organizations")
      .doc(ORG_A)
      .collection("teams")
      .doc(TEAM_A1)
      .set({
        name: "Team A1",
        orgName: "Org A",
        createdBy: USERS.alice.uid,
        createdAt: new Date("2026-08-31T10:00:00.000Z"),
      });
  });
});

describe("exacte create- en updatevorm", () => {
  it("staat een geldige organisatiecreate toe en weigert extra velden", async () => {
    const db = authCtx(env, USERS.grace.uid, {
      email: USERS.grace.email,
      email_verified: true,
    });
    await assertSucceeds(
      setDoc(doc(db, "organizations", "org-valid"), {
        name: "Fictieve organisatie",
        createdBy: USERS.grace.uid,
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db, "organizations", "org-malformed"), {
        name: "Fictieve organisatie",
        createdBy: USERS.grace.uid,
        createdAt: serverTimestamp(),
        injectedRole: "organizationOwner",
      }),
    );
  });

  it("owner kan alleen de organisatienaam wijzigen", async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    await assertSucceeds(
      updateDoc(doc(db, "organizations", ORG_A), { name: "Nieuwe naam" }),
    );
    await assertFails(
      updateDoc(doc(db, "organizations", ORG_A), { createdBy: USERS.bob.uid }),
    );
  });

  it("owner/admin kan alleen een geldige teamnaam wijzigen of een exact team maken", async () => {
    const ownerDb = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    const adminDb = authCtx(env, USERS.bob.uid, { email: USERS.bob.email });
    await assertSucceeds(
      setDoc(doc(adminDb, "organizations", ORG_A, "teams", "team-nieuw"), {
        name: "Nieuw team",
        orgName: "Org A",
        createdBy: USERS.bob.uid,
        createdAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(adminDb, "organizations", ORG_A, "teams", TEAM_A1), {
        name: "Team A2",
      }),
    );
    await assertFails(
      updateDoc(doc(ownerDb, "organizations", ORG_A, "teams", TEAM_A1), {
        orgName: "Vervalste organisatie",
      }),
    );
  });
});

describe("parent hard-delete", () => {
  it("weigert organisatie-delete ook voor de owner", async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    await assertFails(deleteDoc(doc(db, "organizations", ORG_A)));
  });

  it("weigert team-delete voor owner en admin", async () => {
    const ownerDb = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    const adminDb = authCtx(env, USERS.bob.uid, { email: USERS.bob.email });
    await assertFails(
      deleteDoc(doc(ownerDb, "organizations", ORG_A, "teams", TEAM_A1)),
    );
    await assertFails(
      deleteDoc(doc(adminDb, "organizations", ORG_A, "teams", TEAM_A1)),
    );
  });
});
