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
  // Bewaakt tegen de meest waarschijnlijke operatorfout: het voorbeeldbestand
  // 1-op-1 naar .env.${context} kopiëren zonder de placeholder in te vullen.
  if (value.startsWith('vervang-')) {
    throw new Error(
      `Ongeldige Firebase-webconfig voor context "${context}": env-variabele ${name} bevat nog de ` +
        `placeholderwaarde uit v2/.env.${context}.example ("${value}"). Vul de echte waarde in.`,
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

/**
 * Ontbrekende `VITE_DEPLOY_CONTEXT` valt terug op `development` — het huidige,
 * ongewijzigde gedrag voor lokale dev/CI zonder env-bestand. Een wél gezette
 * maar onbekende waarde (bijv. een typo als "stagin") gooit een expliciete
 * fout in plaats van stil naar de emulator te vallen — anders praat een
 * verkeerd geconfigureerde staging/productie-build ongemerkt tegen
 * 127.0.0.1 in plaats van het echte project.
 */
export function resolveDeployContext(env: EnvSource = import.meta.env): DeployContext {
  const raw = env.VITE_DEPLOY_CONTEXT;
  if (raw === undefined || raw === '') return 'development';
  if (raw === 'development' || raw === 'staging' || raw === 'production') return raw;
  throw new Error(
    `Onbekende VITE_DEPLOY_CONTEXT: "${String(raw)}". Verwacht "development", "staging" of ` +
      `"production" (of helemaal niet gezet, dan geldt "development").`,
  );
}
