import { payloadHash } from '../migration/fingerprint';
import type { OrganizationExportV1 } from './types';

/** Canonieke JSON-serialisatie voor de gedownloade organisatie-exportbestand. */
export function serializeOrganizationExport(data: OrganizationExportV1): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Plan werk 3 ("lokale roundtrip → download"): bewijst dat het gebouwde
 * exportobject volledig JSON-veilig is — een `undefined`-waarde, functie of
 * niet-JSON-primitief die per ongeluk toch in een rij was geslopen zou bij
 * `JSON.stringify()`/`JSON.parse()` stilzwijgend verdwijnen of veranderen,
 * en dat mag nooit onopgemerkt in een gedownload bestand belanden (plan §C
 * 8.3b acceptatie: "geen bestand met een vals volledigheidslabel"). Gebruikt
 * `payloadHash()` (stabiele sleutelvolgorde) voor de vergelijking i.p.v.
 * `JSON.stringify()`-gelijkheid, want key-volgorde is hier niet betekenisvol.
 */
export function verifyOrganizationExportRoundtrip(data: OrganizationExportV1): boolean {
  const roundTripped: unknown = JSON.parse(serializeOrganizationExport(data));
  return payloadHash(roundTripped) === payloadHash(data);
}
