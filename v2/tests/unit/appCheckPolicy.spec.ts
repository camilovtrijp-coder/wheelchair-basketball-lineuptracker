import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourceFiles = [
  'src/infrastructure/firebase/firebaseClient.ts',
  'src/infrastructure/firebase/webConfig.ts',
  '.env.staging.example',
  '.env.production.example',
];

describe('PR 8.3a App Check bron- en configuratiebeleid', () => {
  it('activeert uitsluitend de Enterprise-provider en nooit de SDK-debugmodus', () => {
    const combined = sourceFiles
      .map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'))
      .join('\n');

    expect(combined).toContain('ReCaptchaEnterpriseProvider');
    expect(combined).not.toMatch(/FIREBASE_APPCHECK_DEBUG_TOKEN/i);
    expect(combined).not.toMatch(/debugProvider/i);
  });
});
