// Gedeelde testomgeving voor alle rules-specs. Initialiseert één
// RulesTestEnvironment per spec-bestand via beforeAll/afterAll.

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8');

// Vaste project-ID (demo-prefix = emulator-only, geen echt GCP-project).
const PROJECT_ID = 'demo-lineup-tracker-dev';

export async function createTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: RULES,
      host: '127.0.0.1',
      port: 8080,
    },
  });
}

// Helpers voor veelgebruikte beweringen — re-exporteer zodat specs clean zijn.
export { assertSucceeds, assertFails };

// Maakt een mock-auth-context met de gegeven claims.
export function authCtx(
  env: RulesTestEnvironment,
  uid: string,
  extraClaims: Record<string, unknown> = {},
) {
  return env.authenticatedContext(uid, extraClaims).firestore();
}

// Anonieme (niet-ingelogde) context.
export function unauthCtx(env: RulesTestEnvironment) {
  return env.unauthenticatedContext().firestore();
}

// Admin-context (omzeilt rules — voor fixture-setup binnen een spec).
export async function withAdmin<T>(
  env: RulesTestEnvironment,
  fn: (db: FirebaseFirestore.Firestore) => Promise<T>,
): Promise<T> {
  let result!: T;
  await env.withSecurityRulesDisabled(async (ctx) => {
    result = await fn(ctx.firestore() as unknown as FirebaseFirestore.Firestore);
  });
  return result;
}
