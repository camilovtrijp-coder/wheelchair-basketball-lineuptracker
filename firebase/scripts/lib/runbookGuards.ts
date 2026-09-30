// PR 8.3c-1d: bewaking voor het alleen-lezen inventarisscript. Puur en unit-testbaar; het
// CLI-bestand (`orgInventory.ts`) roept deze aan vóór het iets initialiseert.
import path from 'node:path';

/** Repositoryroot (`firebase/scripts/lib` → drie niveaus omhoog). */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/** Het runbook gebruikt de ingelogde CLI/ADC-sessie van de beheerder, nooit een sleutelbestand. */
export function assertNoKeyFile(env: NodeJS.ProcessEnv = process.env): void {
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS is gezet. Het runbook werkt uitsluitend met een ingelogde ' +
        'sessie (`gcloud auth application-default login`), nooit met een service-accountsleutel. ' +
        'Zet de variabele weg en probeer opnieuw.',
    );
  }
}

/** De dump bevat persoonsgegevens (e-mail, namen) en mag nooit in de werkboom terechtkomen. */
export function assertOutsideRepo(outFile: string, repoRoot: string = REPO_ROOT): void {
  const relative = path.relative(repoRoot, path.resolve(outFile));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error(
      `--out (${outFile}) ligt binnen de repository. De dump bevat persoonsgegevens: kies een ` +
        'map buiten de werkboom.',
    );
  }
}

export interface InventoryArgs {
  project: string;
  org: string;
  out?: string;
}

export function parseInventoryArgs(argv: string[]): InventoryArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`ongeldig argument bij ${flag ?? '(leeg)'}; gebruik --project, --org, --out`);
    }
    values.set(flag.slice(2), value);
  }
  const unknown = [...values.keys()].filter((key) => !['project', 'org', 'out'].includes(key));
  if (unknown.length > 0) throw new Error(`onbekende opties: ${unknown.join(', ')}`);
  const project = values.get('project');
  const org = values.get('org');
  if (!project) throw new Error('--project is verplicht (geen impliciet standaardproject)');
  if (!org) throw new Error('--org is verplicht');
  return { project, org, out: values.get('out') };
}
