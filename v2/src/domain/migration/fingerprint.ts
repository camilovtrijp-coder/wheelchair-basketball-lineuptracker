/**
 * PR 7.4a (docs/pr-7.4-plan.md §C 7.4a werk 3): pure, deterministische
 * hashing/ID-afleiding voor de cloud-migratiepreview. Geen Firebase-/
 * storage-import — puur data in, puur string uit, dezelfde invoer levert
 * altijd dezelfde uitvoer op (vereist voor "dezelfde bron/doelcombinatie
 * levert exact hetzelfde manifest" en voor 7.4b's latere idempotente retry).
 *
 * Geen bestaande hashutility hergebruikt: `domain/game/syncCheckpoint.ts` en
 * `domain/backup/*` houden geen content-hash bij (alleen ID-lijsten/
 * revisienummers), dus dit is een nieuw, klein, doelbewust primitief —
 * bewust GEEN cryptografische hash (geen `crypto.subtle` nodig, dit is geen
 * beveiligingsgrens maar alleen "is de payload sinds de vorige preview
 * veranderd").
 */

/**
 * Stabiele JSON-serialisatie: objectsleutels worden ALTIJD alfabetisch
 * gesorteerd, ongeacht insertievolgorde — `JSON.stringify()` bewaart
 * insertievolgorde, wat twee inhoudelijk identieke objecten met een andere
 * bouwvolgorde (bijv. spread-volgorde) een andere string zou geven. Arrays
 * behouden hun eigen volgorde (die IS betekenisvol — zie `sequence`/
 * segmentvolgorde elders in het domein).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortForHash(value));
}

function sortForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForHash);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortForHash(v);
    return out;
  }
  return value;
}

/**
 * FNV-1a 32-bit, hex-gecodeerd. Geen beveiligingsdoel (zie header) — alleen
 * een goedkope, deterministische, platformonafhankelijke (geen
 * `crypto.subtle` nodig, werkt ook synchroon/in Node zonder async) content-
 * vingerafdruk. Botsingen zijn hier onschadelijk: een hash-gelijkenis is
 * altijd maar een VERSNELLING van "is dit gewijzigd", nooit de enige bron
 * van waarheid voor identiteit (die blijft altijd het echte, expliciete
 * bron-/doel-ID, zie `deriveDeterministicMigrationId()` hieronder).
 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Content-hash van een willekeurige puur-data payload — stabiele stringify + FNV-1a. */
export function payloadHash(value: unknown): string {
  return fnv1a(stableStringify(value));
}

/**
 * Deterministische doel-ID voor één te migreren item (plan §B: "IDs zijn
 * deterministisch: bestaande v2-UUID's blijven gelijk; legacybron gebruikt
 * bronfingerprint + bron-ID + doelcontext. Retry maakt geen duplicaat.").
 *
 * Ontwerpbeslissing (7.4a, genomen bij ontbreken van een expliciete
 * plan-uitwerking — zie docs/pr-7.4-plan.md-update onder 7.4a
 * "Geïmplementeerd"): elke lokale bron die déze inventarisatie (`localInventory.ts`)
 * kan opleveren draagt al een stabiel v2-UUID (`CompletedGame.id`/
 * `ActiveGame.id`) of is een singleton-document (settings/roster,
 * `sourceId: 'current'`) — de "bestaande v2-UUID's blijven gelijk"-tak van
 * §B is daarmee voor ELKE huidige bron van toepassing: het doel-ID is
 * simpelweg het bron-ID zelf (settings/roster: de vaste padnaam;
 * activeGame/completedGame: het bestaande UUID). Een v1-blob levert nooit
 * rechtstreeks aan deze pijplijn — die wordt eerst door
 * `domain/game/v1Migration.ts` naar een v2-UUID omgezet vóórdat 'ie ooit een
 * `ActiveGame` wordt. De "legacybron gebruikt bronfingerprint + bron-ID +
 * doelcontext"-tak van §B is voor de huidige broncontexten dus dode code —
 * toch hieronder als apart, zuiver, herbruikbaar primitief geïmplementeerd
 * (met determinisme-test) voor 7.4b/een toekomstige niet-UUID-bron, i.p.v.
 * de twee schema's te vermengen in één functie.
 */
export function deriveExistingUuidMigrationId(existingUuid: string): string {
  return existingUuid;
}

/**
 * Zie de docstring hierboven — bewust ongebruikt door `preview.ts` voor de
 * huidige broncontexten, wel volledig getest (`payloadHash`/determinisme).
 * `sourceFingerprint` identificeert de HERKOMST (bijv. welk lokaal apparaat/
 * welke legacy-opslag), los van de item-inhoud — zodat een retry vanaf
 * dezelfde bron altijd hetzelfde doel-ID herproduceert, ook als de
 * item-INHOUD tussen twee pogingen is gewijzigd (een contentgebaseerd ID zou
 * bij elke wijziging een nieuw, dubbel doelitem opleveren — precies wat §B
 * verbiedt: "Retry maakt geen duplicaat").
 */
export function deriveLegacyMigrationId(
  sourceFingerprint: string,
  sourceId: string,
  targetContext: { organizationId: string; teamId: string },
): string {
  return fnv1a(
    stableStringify({
      sourceFingerprint,
      sourceId,
      organizationId: targetContext.organizationId,
      teamId: targetContext.teamId,
    }),
  );
}
