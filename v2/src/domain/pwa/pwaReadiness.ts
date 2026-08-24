/**
 * PR 8.1b (docs/pr-8.1-plan.md §C 8.1b werk 1): pure PWA-/offline-
 * gereedheidsstatus voor de pre-game readinesscheck. Bewust een EIGEN module
 * (`domain/pwa/`) en NIET naast `domain/game/writerClaim.ts` — dat bestand
 * gaat specifiek over het single-writer-protocol (writer-claims/epochs),
 * terwijl PWA-gereedheid een orthogonale infrastructuurdimensie is. Een
 * aparte module houdt `writerClaim.ts`'s single-responsibility schoon en
 * maakt het makkelijker om later (bv. in 8.3) extra PWA-readiness-signalen
 * toe te voegen zonder die module op te blazen (externe review PR #74).
 *
 * Puur, zoals de rest van `domain/`: geen Firebase-/browser-API-imports.
 * `application/pwa/usePwaReadiness.ts` verzamelt de browser-/adapterstatus
 * en roept `derivePwaReadinessStatus()` hier aan — zelfde patroon als
 * `gameStartBlockReason()` zelf (puur, aanroeper verzamelt de inputs).
 */

/**
 * Vijf onderscheiden deelstatussen:
 * - `unsupported`: `'serviceWorker' in navigator` is `false` op dit
 *   apparaat/deze browser. Blokkeert een wedstrijdstart NOOIT (stopregel
 *   §D) — alleen-lokale modus zonder SW-ondersteuning blijft werken.
 * - `registering`: de browser ondersteunt service workers, maar de
 *   registratie is nog niet als geslaagd bevestigd (bv. vlak na paginaload,
 *   vóórdat `register()`'s promise is opgelost). Blokkeert niet — dit is een
 *   normale, kortstondige overgangsstatus.
 * - `ready`: actieve, geregistreerde SW zonder wachtende update — de
 *   app-shell is aantoonbaar offline-klaar.
 * - `update-pending`: er staat een `registration.waiting`/reloading-update
 *   klaar (zelfde signaal als `PwaUpdateAdapter`'s `update-available`/
 *   `reloading`). Blokkeert een nieuwe wedstrijdstart NIET — het is een
 *   zichtbaarheidssignaal zodat de gebruiker vóór tip-off kan kiezen bij te
 *   werken i.p.v. midden in de wedstrijd (§C 8.1b werk 1).
 * - `broken`: een AANTOONBAAR kapotte registratie op een apparaat dat wél
 *   SW-ondersteuning claimt (de adapter meldt `status: 'error'`). Dit is de
 *   ENIGE deelstatus die een wedstrijdstart blokkeert (werk 4).
 *
 *   8.1c (docs/pr-8.1-plan.md §C 8.1c werk 2): dekt sinds de classic-SW-
 *   fallback (`infrastructure/pwa/PwaUpdateAdapter.ts`) ook het volledig
 *   gedegradeerde pad — de adapter probeert bij ontbrekende module-SW-
 *   ondersteuning eerst de classic-fallbackbundel; pas als OOK die
 *   registratie mislukt, meldt de adapter `status: 'error'`, en dus
 *   `broken` hier. Bewust GEEN eigen, zesde deelstatus: `swSupported` blijft
 *   op zo'n apparaat `true` (`'serviceWorker' in navigator` is aanwezig,
 *   alleen de registratie zelf faalt) en `adapterStatus: 'error'` is precies
 *   hetzelfde signaal als elke andere aantoonbaar kapotte registratie — de
 *   oorzaak (module vs. classic vs. allebei geprobeerd) is voor de
 *   pre-game-gate irrelevant, alleen het eindresultaat telt.
 */
export type PwaReadinessStatus =
  | { kind: 'unsupported' }
  | { kind: 'registering' }
  | { kind: 'ready' }
  | { kind: 'update-pending' }
  | { kind: 'broken' };

/**
 * Zelfde statuswaarden als `PwaUpdateStatus`
 * (`infrastructure/pwa/PwaUpdateAdapter.ts`), hier bewust opnieuw als
 * losstaand literal-union type gedeclareerd i.p.v. geïmporteerd — `domain/`
 * mag niets uit `infrastructure/` importeren (ADR-000-laagregel), ook geen
 * puur type-only import.
 */
export type PwaAdapterStatusSnapshot = 'idle' | 'update-available' | 'reloading' | 'error';

/** Plat, door de aanroeper (application-laag) verzameld momentopname-object —
 * geen browser-API's, geen klasse-instanties. */
export interface PwaReadinessSnapshot {
  /** `'serviceWorker' in navigator`. */
  swSupported: boolean;
  /** `PwaUpdateAdapter.getState().status`. */
  adapterStatus: PwaAdapterStatusSnapshot;
  /** Of de registratie ooit succesvol is afgerond (`getState().registered`) —
   * onderscheidt "nog bezig" (`registering`) van "actief en geprecached"
   * (`ready`), die de adapter allebei als `status: 'idle'` rapporteert. */
  registered: boolean;
}

export function derivePwaReadinessStatus(snapshot: PwaReadinessSnapshot): PwaReadinessStatus {
  if (!snapshot.swSupported) return { kind: 'unsupported' };
  if (snapshot.adapterStatus === 'error') return { kind: 'broken' };
  if (snapshot.adapterStatus === 'update-available' || snapshot.adapterStatus === 'reloading') {
    return { kind: 'update-pending' };
  }
  return snapshot.registered ? { kind: 'ready' } : { kind: 'registering' };
}
