import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
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

/**
 * Elke niet-uitgecommentarieerde `match /...` -regel in de Firestore
 * datasectie (het topniveau-`match /databases/{database}/documents`-
 * omhulsel uitgezonderd). Werkt in BEIDE richtingen samen met de matrix: een
 * nieuwe Rules-match die hier verschijnt maar geen matrixrij heeft, of een
 * matrixrij zonder werkelijke Rules-match, laat de test hieronder falen.
 */
function discoverRuleMatches(rulesSource: string): string[] {
  const found: string[] = [];
  for (const rawLine of rulesSource.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("//")) continue;
    const match = line.match(/^match (\/\S+)\s*\{/);
    const target = match?.[1];
    if (target === undefined) continue;
    if (target.includes("databases/{database}/documents")) continue;
    found.push(`match ${target}`);
  }
  return found;
}

/**
 * Zet een OS-specifiek relatief pad (`path.relative()`-uitvoer, met
 * backslashes op Windows) om naar de platformonafhankelijke forward-slash-
 * vorm die de matrix gebruikt. Vervangt backslashes expliciet i.p.v. te
 * splitsen op `path.sep` — `path.sep` is op Linux/macOS zelf al `/`, dus een
 * `sep`-gebaseerde split zou op die platforms een letterlijk Windows-pad
 * (backslashes) ongewijzigd laten en het onderstaande regressiebewijs een
 * no-op maken. Losse functie zodat een test op Linux-CI ook het
 * Windows-padscenario kan bewijzen zonder een echte Windows-checkout nodig
 * te hebben (P1-herreview op PR #85: de vaste-prefix-plus-`slice()`-aanpak
 * liet Windows-backslashes onvertaald staan).
 */
export function toMatrixRelativePath(osRelativePath: string): string {
  return osRelativePath.split("\\").join("/");
}

/**
 * Elk `.ts`-bestand onder `v2/src/infrastructure` (converterbestanden en
 * tests uitgezonderd) dat rechtstreeks een Firestore-pad opbouwt via
 * `doc(`/`collection(`/`collectionGroup(`. Dit ontdekt de daadwerkelijke
 * bronbestanden vanaf de schijf i.p.v. een tweede handmatige lijst, zodat een
 * vergeten nieuwe gateway niet stilzwijgend buiten `FIRESTORE_CLIENT_GATEWAY_
 * FILES` kan blijven.
 */
function discoverFirestorePathBuilderFiles(): string[] {
  const infraRoot = resolve(firebaseRoot, "../v2/src/infrastructure");
  const directPathBuilderPattern = /\b(doc|collection|collectionGroup)\(/;
  const found: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ts")) continue;
      if (entry.name.endsWith(".spec.ts") || entry.name.endsWith(".test.ts"))
        continue;
      const content = readFileSync(fullPath, "utf8");
      if (directPathBuilderPattern.test(content)) {
        found.push(
          `../v2/src/infrastructure/${toMatrixRelativePath(relative(infraRoot, fullPath))}`,
        );
      }
    }
  }

  walk(infraRoot);
  return found;
}

/**
 * Elke `export const xConverter: FirestoreDataConverter<...>` in
 * `firebase/src/documents`. Ontdekt vanaf de schijf zodat een nieuwe
 * converter die nergens in de matrix wordt gekoppeld ook faalt, niet alleen
 * een matrixrij die naar een niet-bestaande converter verwijst.
 */
function discoverConverterExportNames(): string[] {
  const documentsRoot = resolve(firebaseRoot, "src/documents");
  const converterExportPattern =
    /export const (\w+Converter): FirestoreDataConverter/g;
  const found: string[] = [];
  for (const entry of readdirSync(documentsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const content = readFileSync(join(documentsRoot, entry.name), "utf8");
    for (const match of content.matchAll(converterExportPattern)) {
      const converterName = match[1];
      if (converterName !== undefined) found.push(converterName);
    }
  }
  return found;
}

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

  it("dekt elke werkelijke Rules-datascope in BEIDE richtingen (geen vergeten of overbodige matrixrij)", () => {
    const discoveredRuleMatches = discoverRuleMatches(rules);
    const matrixRuleMatches = FIRESTORE_ACCESS_MATRIX.map(
      (entry) => entry.ruleMatch,
    );
    expect(
      new Set(discoveredRuleMatches).size,
      "duplicate Rules-matches ontdekt",
    ).toBe(discoveredRuleMatches.length);
    expect([...matrixRuleMatches].sort()).toEqual(
      [...discoveredRuleMatches].sort(),
    );
  });

  it("normaliseert Windows-padscheidingstekens naar de forward-slash-vorm die de matrix gebruikt", () => {
    // Simuleert path.relative()'s Windows-uitvoer (backslashes) op elk platform
    // waar deze suite draait, inclusief Linux-CI — bewijst dat de discovery
    // ook op een Windows-checkout dezelfde paden oplevert als in de matrix.
    expect(
      toMatrixRelativePath("game\\FirestoreCompletedGameRepository.ts"),
    ).toBe("game/FirestoreCompletedGameRepository.ts");
    expect(
      toMatrixRelativePath("organizations/FirestoreOrganizationGateway.ts"),
    ).toBe("organizations/FirestoreOrganizationGateway.ts");
  });

  it("houdt FIRESTORE_CLIENT_GATEWAY_FILES gelijk aan de daadwerkelijke direct-Firestore-padbouwende bronbestanden", () => {
    const discovered = discoverFirestorePathBuilderFiles();
    expect([...discovered].sort()).toEqual(
      [...FIRESTORE_CLIENT_GATEWAY_FILES].sort(),
    );
  });

  it("houdt ieder huidig Firestore-clientgatewaybestand aan minimaal een matrixrij gekoppeld", () => {
    const coveredSources = new Set(
      FIRESTORE_ACCESS_MATRIX.flatMap((entry) => entry.clientSources),
    );
    expect([...coveredSources].sort()).toEqual(
      [...FIRESTORE_CLIENT_GATEWAY_FILES].sort(),
    );
  });

  it("koppelt converters in BEIDE richtingen: elke matrix-converterSource bestaat en wordt echt gebruikt, elke echte converter staat in de matrix", () => {
    const discoveredConverters = discoverConverterExportNames();
    const usedConverters = new Set<string>();

    for (const entry of FIRESTORE_ACCESS_MATRIX) {
      for (const converterName of entry.converterSources) {
        expect(
          discoveredConverters,
          `${entry.id}: onbekende converter ${converterName}`,
        ).toContain(converterName);
        usedConverters.add(converterName);

        const referencedInClientSource = entry.clientSources.some((source) =>
          readFileSync(resolve(firebaseRoot, source), "utf8").includes(
            converterName,
          ),
        );
        expect(
          referencedInClientSource,
          `${entry.id}: ${converterName} niet aangetroffen in eigen clientSources`,
        ).toBe(true);
      }
    }

    // migration-runs heeft bewust geen converter (zie de entry's `conditions`);
    // elke andere converter die op schijf bestaat moet aan minimaal een
    // matrixrij gekoppeld zijn.
    expect([...usedConverters].sort()).toEqual(
      [...discoveredConverters].sort(),
    );

    const entriesWithoutConverter = FIRESTORE_ACCESS_MATRIX.filter(
      (entry) => entry.converterSources.length === 0,
    ).map((entry) => entry.id);
    expect(entriesWithoutConverter).toEqual(["migration-runs"]);
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
