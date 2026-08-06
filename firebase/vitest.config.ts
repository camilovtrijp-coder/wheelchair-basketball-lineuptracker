import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['tests/**/*.spec.ts'],
    // Rules-specs delen één Firestore-emulator en mogen niet gelijktijdig
    // clearFirestore() aanroepen (transactieconflicten); unit-specs hebben
    // geen emulator nodig maar draaien in dezelfde single-fork-pool omwille
    // van een simpele, voorspelbare configuratie.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
