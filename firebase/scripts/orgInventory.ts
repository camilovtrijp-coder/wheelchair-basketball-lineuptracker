// PR 8.3c-1d — ALLEEN-LEZEN inventaris van één organisatie voor het verwijderrunbook
// (docs/pr-8.3c-runbook.md). Schrijft niets naar Firestore. Gebruik:
//   npm --workspace firebase run runbook:inventory -- --project <id> --org <orgId> [--out <bestand buiten de repo>]
// Tegen een echt project: Application Default Credentials van de beheerder
// (`gcloud auth application-default login`), nooit een sleutelbestand. Tegen de emulator:
// laat de FIRESTORE_EMULATOR_HOST-variabele staan (door `firebase emulators:exec` gezet).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  canonicalDump,
  dumpDocuments,
  hashDump,
  inventoryOrganization,
} from './lib/orgInventory.js';
import {
  assertEmulatorMatchesProject,
  assertNoKeyFile,
  assertOutsideRepo,
  parseInventoryArgs,
} from './lib/runbookGuards.js';

const args = parseInventoryArgs(process.argv.slice(2));
assertNoKeyFile();
assertEmulatorMatchesProject(args.project);
if (args.out) assertOutsideRepo(args.out);

const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
initializeApp(
  usingEmulator
    ? { projectId: args.project }
    : { projectId: args.project, credential: applicationDefault() },
);
const db = getFirestore();

const startedAt = Date.now();
const inventory = await inventoryOrganization(db, args.org);
const dump = canonicalDump(dumpDocuments(inventory));
const contentHash = hashDump(dump);

console.log(
  JSON.stringify(
    {
      target: usingEmulator ? 'emulator' : `project ${args.project}`,
      organizationId: inventory.organizationId,
      organizationExists: inventory.organizationExists,
      totalDocuments: inventory.totalDocuments,
      counts: inventory.counts,
      deletionRequests: inventory.deletionRequests,
      unmapped: inventory.unmapped,
      contentHash,
      durationMs: Date.now() - startedAt,
    },
    null,
    2,
  ),
);

if (args.out) {
  mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  writeFileSync(args.out, dump, { mode: 0o600 });
  console.log(`dump geschreven naar ${args.out} (bevat persoonsgegevens; bewaar niet in Git)`);
}
