import { translate, type Lang, type StringKey } from '../../i18n/strings';
import type { DeletionRequest } from '../../domain/deletion/types';

/** Datum in de taal van de gebruiker; een onleesbare waarde valt terug op de kale string. */
export function formatDeletionDate(iso: string, lang: Lang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(lang === 'nl' ? 'nl-NL' : 'en-GB');
}

/**
 * PR 8.3c-1c (besluitrecord §2.5): een permanente melding, zichtbaar voor alle
 * organisatieleden zolang een verwijderverzoek open staat. Bewust GEEN
 * functionele lockdown van de organisatie — dat zou over vrijwel elk pad nieuwe
 * Rules vragen en de offline wedstrijdbediening kunnen raken. Alleen een
 * informatieve melding.
 *
 * Leden die alleen via een team toegang hebben lezen het verzoek niet (Rules:
 * `isOrgMember`) en zien deze melding dus niet: geaccepteerd restrisico,
 * besluitrecord §8.3, met een handmatige informatieplicht voor de owner.
 *
 * `cancelled` en `null` tonen niets; `completed` bestaat in de praktijk nooit voor
 * een lid (de organisatie is dan weg), en toont dan ook niets.
 */
export function DeletionRequestBanner({
  lang,
  request,
}: {
  lang: Lang;
  request: DeletionRequest | null;
}) {
  if (request === null) return null;
  let key: StringKey;
  switch (request.status) {
    case 'requested':
      key = 'deletionBannerRequested';
      break;
    case 'executing':
      key = 'deletionBannerExecuting';
      break;
    case 'failed':
      key = 'deletionBannerFailed';
      break;
    default:
      return null;
  }
  return (
    <div className="settings-error" role="status" data-testid="deletion-banner">
      <p>{translate(lang, key).replace('{date}', formatDeletionDate(request.requestedAt, lang))}</p>
    </div>
  );
}
