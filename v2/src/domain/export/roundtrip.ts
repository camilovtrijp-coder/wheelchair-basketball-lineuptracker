import { payloadHash } from '../migration/fingerprint';
import type { OrganizationExportV1 } from './types';

/** Canonieke JSON-serialisatie voor de gedownloade organisatie-exportbestand. */
export function serializeOrganizationExport(data: OrganizationExportV1): string {
  return JSON.stringify(data, null, 2);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Herreview PR #87 (P1): een `undefined`-waarde in een object-property wordt
 * door `JSON.stringify()` stilzwijgend WEGGELATEN, en `payloadHash()`
 * (`stableStringify()`'s `sortForHash()`) filtert diezelfde `undefined`-
 * properties er zelf óók uit vóór het hashen. Een hash-vergelijking tussen
 * `data` en `JSON.parse(JSON.stringify(data))` kan zo'n verdwenen veld dus
 * NOOIT zien — beide kanten hashen tot hetzelfde resultaat, terwijl het
 * gedownloade bestand het veld al kwijt is (`{"verified":true,
 * "serializedHasField":false}`, reproduceerbaar). Dit doorloopt de structuur
 * daarom eerst zelf, recursief, op precies de waarden die JSON niet kan
 * dragen: `undefined`, functies, `symbol`/`bigint`, niet-eindige getallen
 * (`NaN`/`Infinity`), en niet-platte objecten (bijv. een rauw `Date`-object
 * dat via `toJSON()` in iets anders verandert). Arrays met een `undefined`-
 * element worden ook geweigerd: `JSON.stringify()` zet die stilzwijgend om
 * naar `null`, wat evenzeer een stil betekenisverlies is.
 */
function isJsonSafe(value: unknown): boolean {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return true;
  if (type === 'number') return Number.isFinite(value as number);
  if (type === 'undefined' || type === 'function' || type === 'symbol' || type === 'bigint') {
    return false;
  }
  if (Array.isArray(value)) return value.every(isJsonSafe);
  if (isPlainObject(value)) return Object.values(value).every(isJsonSafe);
  // Al het andere (Date, Map, Set, class-instanties, ...) is geen platte JSON-waarde.
  return false;
}

/**
 * Plan werk 3 ("lokale roundtrip → download"): bewijst dat het gebouwde
 * exportobject volledig JSON-veilig is — een `undefined`-waarde, functie of
 * niet-JSON-primitief die per ongeluk toch in een rij was geslopen zou bij
 * `JSON.stringify()`/`JSON.parse()` stilzwijgend verdwijnen of veranderen,
 * en dat mag nooit onopgemerkt in een gedownload bestand belanden (plan §C
 * 8.3b acceptatie: "geen bestand met een vals volledigheidslabel"). De
 * structurele `isJsonSafe()`-controle hierboven is de daadwerkelijke
 * garantie; de aanvullende hashvergelijking (`payloadHash()`, stabiele
 * sleutelvolgorde) blijft erna staan als extra bewijs dat de roundtrip zelf
 * ook geen andere structurele verandering veroorzaakt.
 */
export function verifyOrganizationExportRoundtrip(data: OrganizationExportV1): boolean {
  if (!isJsonSafe(data)) return false;
  const roundTripped: unknown = JSON.parse(serializeOrganizationExport(data));
  return payloadHash(roundTripped) === payloadHash(data);
}
