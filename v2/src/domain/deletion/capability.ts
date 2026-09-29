import type { OrganizationRole } from '../organizations/types';

/**
 * Puur bevoegdheidspredikaat: alleen de `organizationOwner` mag een
 * organisatieverwijdering aanvragen, annuleren of herstarten (besluitrecord
 * §2.5). Bewust een eigen predikaat, niet `canExportOrganization()` — dat is
 * vandaag toevallig dezelfde allowlist, maar het zijn twee verschillende
 * bevoegdheden die niet stilzwijgend samen mogen bewegen. Rules zijn de
 * gezaghebbende grens (`isOrgOwner()`); dit is defense-in-depth en geeft de UI
 * iets om op te leunen zonder een mislukte write af te wachten.
 */
export function canRequestOrganizationDeletion(role: OrganizationRole): boolean {
  return role === 'organizationOwner';
}
