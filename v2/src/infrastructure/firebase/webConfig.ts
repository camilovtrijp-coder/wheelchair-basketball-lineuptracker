// Firebase-webconfig per deploycontext. Pure functies, geen SDK-imports —
// zuiver de vraag "welke configuratie hoort bij welke context", los-testbaar
// zonder Firebase te initialiseren. `firebaseClient.ts` gebruikt deze module
// om te bepalen of/hoe de emulator wordt aangesloten.

export type DeployContext = 'development' | 'staging' | 'production';

export interface FirebaseWebConfig {
  projectId: string;
  apiKey: string;
  authDomain: string;
}

export interface FirebaseEmulatorConfig {
  host: string;
  firestorePort: number;
  authUrl: string;
}

type EnvSource = Record<string, string | boolean | undefined>;

const DEVELOPMENT_WEB_CONFIG: FirebaseWebConfig = {
  projectId: 'demo-lineup-tracker-dev',
  apiKey: 'demo-key',
  authDomain: 'demo-lineup-tracker-dev.firebaseapp.com',
};

const DEVELOPMENT_EMULATOR_CONFIG: FirebaseEmulatorConfig = {
  host: '127.0.0.1',
  firestorePort: 8080,
  authUrl: 'http://127.0.0.1:9099',
};

function envSuffix(context: 'staging' | 'production'): 'STAGING' | 'PRODUCTION' {
  return context === 'staging' ? 'STAGING' : 'PRODUCTION';
}

function requireEnvValue(name: string, context: DeployContext, env: EnvSource): string {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Ontbrekende Firebase-webconfig voor context "${context}": env-variabele ${name} is niet gezet. ` +
        `Zie v2/.env.${context}.example.`,
    );
  }
  return value;
}

/**
 * Levert de Firebase-webconfig voor een deploycontext. `development` gebruikt
 * vaste defaults (de emulator heeft geen echt project nodig); `staging`/
 * `production` lezen verplicht uit env-variabelen — een ontbrekende variabele
 * geeft een expliciete fout in plaats van een stil lege webconfig.
 */
export function resolveWebConfig(
  context: DeployContext,
  env: EnvSource = import.meta.env,
): FirebaseWebConfig {
  if (context === 'development') return DEVELOPMENT_WEB_CONFIG;

  const suffix = envSuffix(context);
  return {
    projectId: requireEnvValue(`VITE_FIREBASE_PROJECT_ID_${suffix}`, context, env),
    apiKey: requireEnvValue(`VITE_FIREBASE_API_KEY_${suffix}`, context, env),
    authDomain: requireEnvValue(`VITE_FIREBASE_AUTH_DOMAIN_${suffix}`, context, env),
  };
}

/** Alleen `development` heeft een emulator; `staging`/`production` praten met echt Firebase. */
export function resolveEmulatorConfig(context: DeployContext): FirebaseEmulatorConfig | null {
  return context === 'development' ? DEVELOPMENT_EMULATOR_CONFIG : null;
}

/** Onbekende of ontbrekende `VITE_DEPLOY_CONTEXT` valt terug op `development` — het huidige, ongewijzigde gedrag. */
export function resolveDeployContext(env: EnvSource = import.meta.env): DeployContext {
  const raw = env.VITE_DEPLOY_CONTEXT;
  return raw === 'staging' || raw === 'production' ? raw : 'development';
}
