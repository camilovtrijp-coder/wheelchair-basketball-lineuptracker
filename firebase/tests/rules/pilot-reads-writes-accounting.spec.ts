// PR 5.4c: reproduceerbare client-call-telling voor de vier twee-apparatenflows.
// Dit is een emulatorproxy, geen Firestore-factuurmeting: Rules-interne reads,
// listener-reconnects en eventueel samengevoegde listener-events zijn niet via
// de Emulator Suite als billable usage uit te lezen. Zie het onderzoeksrapport.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { doc, getDoc, setDoc } from "firebase/firestore";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { authCtx, createTestEnv, withAdmin } from "./helpers/testEnv.js";
import {
  ORG_A,
  ORG_B,
  SAMPLE_SETTINGS,
  TEAM_A1,
  TEAM_A2,
  TEAM_B1,
  USERS,
} from "./helpers/fixtures.js";

type Count = { reads: number; writes: number };

let env: RulesTestEnvironment;

const counts: {
  sameTeamLiveDeliver: Count;
  differentOrganizations: Count;
  deliberateConflict: Count;
  nonConflictingWrites: Count;
} = {
  sameTeamLiveDeliver: { reads: 0, writes: 0 },
  differentOrganizations: { reads: 0, writes: 0 },
  deliberateConflict: { reads: 0, writes: 0 },
  nonConflictingWrites: { reads: 0, writes: 0 },
};

function settingsPath(orgId: string, teamId: string) {
  return [
    "organizations",
    orgId,
    "teams",
    teamId,
    "settings",
    "current",
  ] as const;
}

beforeAll(async () => {
  env = await createTestEnv();
});

beforeEach(async () => {
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    for (const [orgId, teamIds] of [
      [ORG_A, [TEAM_A1, TEAM_A2]],
      [ORG_B, [TEAM_B1]],
    ] as const) {
      await db
        .collection("organizations")
        .doc(orgId)
        .set({
          name: `Fictieve organisatie ${orgId}`,
          createdBy: USERS.alice.uid,
        });
      await db
        .collection("organizations")
        .doc(orgId)
        .collection("organizationMembers")
        .doc(USERS.alice.uid)
        .set({
          role: "organizationOwner",
          email: USERS.alice.email,
          uid: USERS.alice.uid,
        });
      for (const teamId of teamIds) {
        await db
          .collection("organizations")
          .doc(orgId)
          .collection("teams")
          .doc(teamId)
          .set({ name: `Fictief team ${teamId}`, createdBy: USERS.alice.uid });
        await db
          .collection("organizations")
          .doc(orgId)
          .collection("teams")
          .doc(teamId)
          .collection("settings")
          .doc("current")
          .set({ ...SAMPLE_SETTINGS, updatedAt: new Date() });
      }
    }
  });
});

afterAll(async () => {
  const total = Object.values(counts).reduce(
    (sum, count) => ({
      reads: sum.reads + count.reads,
      writes: sum.writes + count.writes,
    }),
    { reads: 0, writes: 0 },
  );
  console.log("\n=== PR 5.4 pilot client-call-telling ===");
  for (const [flow, count] of Object.entries(counts))
    console.log(flow, JSON.stringify(count));
  console.log("Totaal vier scenario’s:", JSON.stringify(total));
  console.log(
    "100 volledige pilot-runs:",
    JSON.stringify({ reads: total.reads * 100, writes: total.writes * 100 }),
  );
  console.log(
    "Rules-interne reads en listener-reconnects zijn niet inbegrepen.\n",
  );
  await env.cleanup();
});

describe("PR 5.4 pilot client-call-telling", () => {
  it("telt live-deliver op hetzelfde team", async () => {
    const deviceA = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    const deviceB = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    const refA = doc(deviceA, ...settingsPath(ORG_A, TEAM_A1));
    const refB = doc(deviceB, ...settingsPath(ORG_A, TEAM_A1));

    await Promise.all([getDoc(refA), getDoc(refB)]);
    counts.sameTeamLiveDeliver.reads += 2;
    await setDoc(refA, { teamName: "Live vanaf A" }, { merge: true });
    counts.sameTeamLiveDeliver.writes += 1;
    expect((await getDoc(refB)).data()?.teamName).toBe("Live vanaf A");
    counts.sameTeamLiveDeliver.reads += 1;

    expect(counts.sameTeamLiveDeliver).toEqual({ reads: 3, writes: 1 });
  });

  it("telt parallelle writes in verschillende organisaties", async () => {
    const deviceA = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    const deviceB = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    const refA = doc(deviceA, ...settingsPath(ORG_A, TEAM_A2));
    const refB = doc(deviceB, ...settingsPath(ORG_B, TEAM_B1));

    await Promise.all([getDoc(refA), getDoc(refB)]);
    counts.differentOrganizations.reads += 2;
    await Promise.all([
      setDoc(refA, { teamName: "Alleen A" }, { merge: true }),
      setDoc(refB, { tag1Label: "Alleen B" }, { merge: true }),
    ]);
    counts.differentOrganizations.writes += 2;
    const [afterA, afterB] = await Promise.all([getDoc(refA), getDoc(refB)]);
    counts.differentOrganizations.reads += 2;

    expect(afterA.data()?.teamName).toBe("Alleen A");
    expect(afterB.data()?.tag1Label).toBe("Alleen B");
    expect(counts.differentOrganizations).toEqual({ reads: 4, writes: 2 });
  });

  it("telt een bewust conflict op hetzelfde veld", async () => {
    const deviceA = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    const deviceB = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    const refA = doc(deviceA, ...settingsPath(ORG_A, TEAM_A1));
    const refB = doc(deviceB, ...settingsPath(ORG_A, TEAM_A1));

    await Promise.all([getDoc(refA), getDoc(refB)]);
    counts.deliberateConflict.reads += 2;
    await Promise.all([
      setDoc(refA, { teamName: "Alpha" }, { merge: true }),
      setDoc(refB, { teamName: "Beta" }, { merge: true }),
    ]);
    counts.deliberateConflict.writes += 2;
    const [afterA, afterB] = await Promise.all([getDoc(refA), getDoc(refB)]);
    counts.deliberateConflict.reads += 2;

    expect(["Alpha", "Beta"]).toContain(afterA.data()?.teamName);
    expect(afterB.data()?.teamName).toBe(afterA.data()?.teamName);
    expect(counts.deliberateConflict).toEqual({ reads: 4, writes: 2 });
  });

  it("telt niet-conflicterende patches op hetzelfde document", async () => {
    const deviceA = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    const deviceB = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    const refA = doc(deviceA, ...settingsPath(ORG_A, TEAM_A2));
    const refB = doc(deviceB, ...settingsPath(ORG_A, TEAM_A2));

    await Promise.all([getDoc(refA), getDoc(refB)]);
    counts.nonConflictingWrites.reads += 2;
    await Promise.all([
      setDoc(refA, { teamName: "Samen X" }, { merge: true }),
      setDoc(refB, { tag1Label: "Samen Y" }, { merge: true }),
    ]);
    counts.nonConflictingWrites.writes += 2;
    const [afterA, afterB] = await Promise.all([getDoc(refA), getDoc(refB)]);
    counts.nonConflictingWrites.reads += 2;

    expect(afterA.data()).toMatchObject({
      teamName: "Samen X",
      tag1Label: "Samen Y",
    });
    expect(afterB.data()).toMatchObject({
      teamName: "Samen X",
      tag1Label: "Samen Y",
    });
    expect(counts.nonConflictingWrites).toEqual({ reads: 4, writes: 2 });
  });
});
