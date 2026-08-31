import { describe, it, expect } from 'vitest';
import {
  resolveAppCheckConfig,
  resolveDeployContext,
  resolveEmulatorConfig,
  resolveWebConfig,
} from '../../src/infrastructure/firebase/webConfig';

describe('infrastructure/firebase/webConfig — resolveAppCheckConfig', () => {
  it('development blijft altijd uit en leest geen externe providerconfig', () => {
    expect(
      resolveAppCheckConfig('development', {
        VITE_FIREBASE_APP_CHECK_ENABLED_STAGING: 'true',
        VITE_FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY_STAGING: 'site-key',
      }),
    ).toEqual({ enabled: false });
  });

  it('staging is standaard uit (monitoring is expliciet opt-in)', () => {
    expect(resolveAppCheckConfig('staging', {})).toEqual({ enabled: false });
    expect(
      resolveAppCheckConfig('staging', { VITE_FIREBASE_APP_CHECK_ENABLED_STAGING: 'false' }),
    ).toEqual({ enabled: false });
  });

  it('leest de staging reCAPTCHA Enterprise-sitekey alleen wanneer expliciet ingeschakeld', () => {
    expect(
      resolveAppCheckConfig('staging', {
        VITE_FIREBASE_APP_CHECK_ENABLED_STAGING: 'true',
        VITE_FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY_STAGING: 'staging-site-key',
      }),
    ).toEqual({
      enabled: true,
      recaptchaEnterpriseSiteKey: 'staging-site-key',
    });
  });

  it('faalt closed bij ingeschakeld zonder sitekey of bij een ongeldige boolean', () => {
    expect(() =>
      resolveAppCheckConfig('production', {
        VITE_FIREBASE_APP_CHECK_ENABLED_PRODUCTION: 'true',
      }),
    ).toThrow(/VITE_FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY_PRODUCTION/);
    expect(() =>
      resolveAppCheckConfig('staging', {
        VITE_FIREBASE_APP_CHECK_ENABLED_STAGING: 'yes',
      }),
    ).toThrow(/true.*false/);
  });
});

describe('infrastructure/firebase/webConfig — resolveWebConfig', () => {
  it('geeft de development-defaults terug, ongeacht env', () => {
    expect(resolveWebConfig('development', {})).toEqual({
      projectId: 'demo-lineup-tracker-dev',
      apiKey: 'demo-key',
      authDomain: 'demo-lineup-tracker-dev.firebaseapp.com',
    });
  });

  it('merget staging-webconfig uit de _STAGING-env-variabelen', () => {
    const config = resolveWebConfig('staging', {
      VITE_FIREBASE_PROJECT_ID_STAGING: 'lineup-tracker-staging',
      VITE_FIREBASE_API_KEY_STAGING: 'staging-key',
      VITE_FIREBASE_AUTH_DOMAIN_STAGING: 'lineup-tracker-staging.firebaseapp.com',
    });
    expect(config).toEqual({
      projectId: 'lineup-tracker-staging',
      apiKey: 'staging-key',
      authDomain: 'lineup-tracker-staging.firebaseapp.com',
    });
  });

  it('merget productie-webconfig uit de _PRODUCTION-env-variabelen', () => {
    const config = resolveWebConfig('production', {
      VITE_FIREBASE_PROJECT_ID_PRODUCTION: 'lineup-tracker-prod',
      VITE_FIREBASE_API_KEY_PRODUCTION: 'prod-key',
      VITE_FIREBASE_AUTH_DOMAIN_PRODUCTION: 'lineup-tracker-prod.firebaseapp.com',
    });
    expect(config).toEqual({
      projectId: 'lineup-tracker-prod',
      apiKey: 'prod-key',
      authDomain: 'lineup-tracker-prod.firebaseapp.com',
    });
  });

  it('gooit een expliciete fout bij een ontbrekende staging-env-variabele, geen lege webconfig', () => {
    expect(() =>
      resolveWebConfig('staging', {
        VITE_FIREBASE_PROJECT_ID_STAGING: 'lineup-tracker-staging',
        // apiKey en authDomain ontbreken bewust
      }),
    ).toThrow(/VITE_FIREBASE_API_KEY_STAGING/);
  });

  it('gooit een expliciete fout bij een volledig lege env voor productie', () => {
    expect(() => resolveWebConfig('production', {})).toThrow(/VITE_FIREBASE_PROJECT_ID_PRODUCTION/);
  });

  it('gooit een expliciete fout bij een niet-ingevulde placeholder uit het voorbeeldbestand', () => {
    expect(() =>
      resolveWebConfig('production', {
        VITE_FIREBASE_PROJECT_ID_PRODUCTION: 'demo-lineup-tracker-prod',
        VITE_FIREBASE_API_KEY_PRODUCTION: 'vervang-met-echte-productie-apikey',
        VITE_FIREBASE_AUTH_DOMAIN_PRODUCTION: 'demo-lineup-tracker-prod.firebaseapp.com',
      }),
    ).toThrow(/placeholderwaarde/);
  });
});

describe('infrastructure/firebase/webConfig — resolveEmulatorConfig', () => {
  it('geeft de emulatorconfig voor development', () => {
    expect(resolveEmulatorConfig('development')).toEqual({
      host: '127.0.0.1',
      firestorePort: 8080,
      authUrl: 'http://127.0.0.1:9099',
    });
  });

  it('geeft null voor staging (geen emulator tegen een echt project)', () => {
    expect(resolveEmulatorConfig('staging')).toBeNull();
  });

  it('geeft null voor productie (geen emulator tegen een echt project)', () => {
    expect(resolveEmulatorConfig('production')).toBeNull();
  });
});

describe('infrastructure/firebase/webConfig — resolveDeployContext', () => {
  it('valt terug op development zonder VITE_DEPLOY_CONTEXT', () => {
    expect(resolveDeployContext({})).toBe('development');
  });

  it('valt terug op development bij een expliciet lege waarde', () => {
    expect(resolveDeployContext({ VITE_DEPLOY_CONTEXT: '' })).toBe('development');
  });

  it('gooit een expliciete fout bij een onbekende, wél gezette waarde (bijv. een typo)', () => {
    expect(() => resolveDeployContext({ VITE_DEPLOY_CONTEXT: 'stagin' })).toThrow(
      /Onbekende VITE_DEPLOY_CONTEXT/,
    );
  });

  it('herkent development, staging en production expliciet', () => {
    expect(resolveDeployContext({ VITE_DEPLOY_CONTEXT: 'development' })).toBe('development');
    expect(resolveDeployContext({ VITE_DEPLOY_CONTEXT: 'staging' })).toBe('staging');
    expect(resolveDeployContext({ VITE_DEPLOY_CONTEXT: 'production' })).toBe('production');
  });
});
