import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['tests/rules/**/*.spec.ts'],
    // Eén process: alle spec-bestanden delen dezelfde Firestore-emulator en
    // mogen niet tegelijk clearFirestore() aanroepen (transactieconflicten).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
