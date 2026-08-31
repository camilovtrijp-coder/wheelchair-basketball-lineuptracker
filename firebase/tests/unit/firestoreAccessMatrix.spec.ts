import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIRESTORE_ACCESS_MATRIX,
  FIRESTORE_CLIENT_GATEWAY_FILES,
  MATRIX_ACTORS,
  type MatrixOperation,
} from "../../src/security/firestoreAccessMatrix";

const firebaseRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rules = readFileSync(resolve(firebaseRoot, "firestore.rules"), "utf8");
const operations: MatrixOperation[] = ["read", "create", "update", "delete"];

describe("PR 8.3a Firestore access matrix", () => {
  it("inventariseert iedere huidige Rules-datascope exact eenmaal", () => {
    const expectedIds = [
      "organization",
      "organization-members",
      "invitations",
      "teams",
      "team-members",
      "settings",
      "roster",
      "games",
      "game-actions",
      "completed-games",
      "migration-runs",
      "organization-members-collection-group",
      "team-members-collection-group",
    ];
    expect(FIRESTORE_ACCESS_MATRIX.map((entry) => entry.id).sort()).toEqual(
      expectedIds.sort(),
    );
    expect(new Set(FIRESTORE_ACCESS_MATRIX.map((entry) => entry.id)).size).toBe(
      FIRESTORE_ACCESS_MATRIX.length,
    );
  });

  it("koppelt iedere matrixrij aan een echte Rules-match en bestaande testbestanden", () => {
    for (const entry of FIRESTORE_ACCESS_MATRIX) {
      expect(rules, entry.id).toContain(entry.ruleMatch);
      expect(entry.evidence.length, entry.id).toBeGreaterThan(0);
      for (const evidence of entry.evidence) {
        expect(
          existsSync(resolve(firebaseRoot, evidence)),
          `${entry.id}: ${evidence}`,
        ).toBe(true);
      }
      expect(
        entry.clientSources.length,
        `${entry.id}: clientSources`,
      ).toBeGreaterThan(0);
      for (const source of entry.clientSources) {
        expect(
          existsSync(resolve(firebaseRoot, source)),
          `${entry.id}: ${source}`,
        ).toBe(true);
      }
    }
  });

  it("houdt ieder huidig Firestore-clientgatewaybestand aan minimaal een matrixrij gekoppeld", () => {
    const coveredSources = new Set(
      FIRESTORE_ACCESS_MATRIX.flatMap((entry) => entry.clientSources),
    );
    expect([...coveredSources].sort()).toEqual(
      [...FIRESTORE_CLIENT_GATEWAY_FILES].sort(),
    );
  });

  it("bevat voor elke operatie uitsluitend bekende actoren, zonder duplicaten", () => {
    for (const entry of FIRESTORE_ACCESS_MATRIX) {
      for (const operation of operations) {
        const actors = entry.permissions[operation];
        expect(new Set(actors).size, `${entry.id}.${operation}`).toBe(
          actors.length,
        );
        for (const actor of actors) {
          expect(MATRIX_ACTORS, `${entry.id}.${operation}.${actor}`).toContain(
            actor,
          );
        }
      }
    }
  });

  it("geeft nergens unauthenticated toegang en houdt immutable cloudfamilies hard-delete-vrij", () => {
    for (const entry of FIRESTORE_ACCESS_MATRIX) {
      for (const operation of operations) {
        expect(
          entry.permissions[operation],
          `${entry.id}.${operation}`,
        ).not.toContain("unauthenticated");
      }
    }
    for (const id of [
      "organization",
      "teams",
      "games",
      "game-actions",
      "completed-games",
      "migration-runs",
    ]) {
      expect(
        FIRESTORE_ACCESS_MATRIX.find((entry) => entry.id === id)?.permissions
          .delete,
      ).toEqual([]);
    }
  });
});
