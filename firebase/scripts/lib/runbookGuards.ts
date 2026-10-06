// PR 8.3c-1d: bewaking voor het alleen-lezen inventarisscript. Puur en unit-testbaar; het
// CLI-bestand (`orgInventory.ts`) roept deze aan vóór het iets initialiseert.
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
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

/** Of er op dit pad een directory-entry staat (ook een hangende symlink). */
function pathEntryExists(candidate: string): boolean {
  try {
    // lstat ziet ook een hangende symlink (doel bestaat nog niet) als bestaand pad; existsSync niet.
    lstatSync(candidate);
    return true;
  } catch {
    return false;
  }
}

/** Bovengrens voor een keten van (hangende) symlinks; daarboven weigert de guard (fail-closed). */
const MAX_SYMLINK_HOPS = 40;

/** Splitst een pad in segmenten zonder te normaliseren: `..` blijft een eigen segment. */
function rawSegments(target: string): string[] {
  const separators = path.sep === '\\' ? /[\\/]+/ : /\/+/;
  return target.split(separators).filter((segment) => segment !== '');
}

/**
 * Lost een pad op zoals het besturingssysteem dat doet: segment voor segment, met symlinks
 * opgelost VÓÓR een volgend `..`. `path.resolve()` normaliseert `..` lexicaal; dan wordt
 * `buiten/link/../x` (met `link` → een map in de repo) ten onrechte `buiten/x`, terwijl het
 * systeem naar de ouder van het linkdoel gaat — binnen de repo (reviewnit #99).
 * Bestaande entries gaan via `realpathSync.native` (normaliseert ook hoofdletters op een
 * niet-hoofdlettergevoelig bestandssysteem); een hangende symlink wordt één niveau gevolgd,
 * met een relatief doel tegen de echte map van de link. Achter het eerste niet-bestaande
 * segment is er niets meer om op te lossen; een `..` daarna haalt alleen dat nog niet
 * bestaande segment weg (zoals `mkdir -p` het zou aanmaken).
 */
function resolveThroughSymlinks(target: string): string {
  const absolute = path.isAbsolute(target) ? target : `${process.cwd()}${path.sep}${target}`;
  const root = path.parse(path.resolve(absolute)).root;
  const pending = rawSegments(absolute.slice(path.parse(absolute).root.length));
  let resolved = realpathSync.native(root);
  let exists = true;
  let hops = 0;
  while (pending.length > 0) {
    const segment = pending.shift() as string;
    if (segment === '.') continue;
    if (segment === '..') {
      // `resolved` is (zolang alles bestaat) een echt pad, dus dirname is de echte ouder.
      resolved = path.dirname(resolved);
      continue;
    }
    const next = path.join(resolved, segment);
    if (!exists || !pathEntryExists(next)) {
      exists = false;
      resolved = next;
      continue;
    }
    try {
      resolved = realpathSync.native(next);
      continue;
    } catch {
      // Hangende symlink (of een keten/kring daarvan): volg één niveau.
    }
    hops += 1;
    if (hops > MAX_SYMLINK_HOPS) {
      throw new Error(
        `--out volgt meer dan ${MAX_SYMLINK_HOPS} symlinkniveaus (of een kringverwijzing); ` +
          'kies een gewoon pad buiten de werkboom.',
      );
    }
    // Faalt readlink (geen symlink, bijv. geen leesrecht), dan gooit de guard: fail-closed.
    const linkTarget = readlinkSync(next);
    if (path.isAbsolute(linkTarget)) {
      resolved = realpathSync.native(path.parse(linkTarget).root);
      pending.unshift(...rawSegments(linkTarget.slice(path.parse(linkTarget).root.length)));
    } else {
      // Relatief doel: tegen de (al echte) map van de link, `resolved` blijft die map.
      pending.unshift(...rawSegments(linkTarget));
    }
  }
  return resolved;
}

/**
 * De dump bevat persoonsgegevens (e-mail, namen) en mag nooit in de werkboom terechtkomen.
 * Vergelijkt echte paden (symlinks opgelost) en behandelt alleen `..` als segment als
 * "naar buiten": een map die `..dump` heet ligt gewoon binnen de repo.
 */
export function assertOutsideRepo(outFile: string, repoRoot: string = REPO_ROOT): void {
  const relative = path.relative(resolveThroughSymlinks(repoRoot), resolveThroughSymlinks(outFile));
  const outside =
    relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (!outside) {
    throw new Error(
      `--out (${outFile}) ligt binnen de repository. De dump bevat persoonsgegevens: kies een ` +
        'map buiten de werkboom.',
    );
  }
}

/**
 * Een gezette FIRESTORE_EMULATOR_HOST stuurt zowel dit script als `firestore:delete` stil naar
 * de emulator: dan geeft de readback nul terwijl de echte data blijft staan. Alleen een
 * `demo-`-project mag met een emulator-host draaien.
 */
export function assertEmulatorMatchesProject(
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.FIRESTORE_EMULATOR_HOST && !project.startsWith('demo-')) {
    throw new Error(
      `FIRESTORE_EMULATOR_HOST is gezet maar --project (${project}) is geen demo-project. ` +
        'Het script zou de emulator lezen in plaats van het echte project en een lege ' +
        'readback als "afgerond" laten doorgaan. Zet de variabele weg (`unset ' +
        'FIRESTORE_EMULATOR_HOST`) en probeer opnieuw.',
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
