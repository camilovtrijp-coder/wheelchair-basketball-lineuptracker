// 8.1a (docs/pr-8.1-plan.md §C 8.1a werk 2): browser-servicewerker-adapter.
// Neemt de registratie over die vóór 8.1a rechtstreeks in `main.tsx` stond
// (`navigator.serviceWorker.register('/sw.js', ...)`), luistert op
// `updatefound`/`installing`-`statechange` en legt een reactieve
// "update beschikbaar"-status vast — zodat `ui/`-componenten nooit
// rechtstreeks met `navigator.serviceWorker` praten (zelfde laagregel als
// ADR-000: `ui/` praat uitsluitend via `application/`, hier via
// `application/pwa/usePwaUpdate.ts`).
//
// KRITIEKE CONSTRAINT (externe review PR #74): de constructor roept
// `navigator.serviceWorker` NOOIT rechtstreeks aan. Registratie en
// event-listeners starten uitsluitend via een expliciete `init()`-aanroep.
// Zonder deze scheiding zou het enkel *aanmaken* van deze adapter (bijv. in
// `App.tsx`, ook gerenderd door bestaande jsdom-gebaseerde componenttests
// zoals `AppGameCloudViewer.spec.tsx` die zich vandaag niets van
// `serviceWorker` aantrekken) al een registratiepoging triggeren — een
// ongemerkte regressie op die tests zodra jsdom ooit een gedeeltelijke
// `serviceWorker`-global zou krijgen. `init()` wordt in de praktijk pas
// aangeroepen door `usePwaUpdate()`'s mount-effect, ná de eerste render.
/**
 * 8.1c (docs/pr-8.1-plan.md §C 8.1c werk 1): korte runtime-capability-check
 * voor module-service-worker-ondersteuning — GEEN user-agent-sniffing (§B
 * punt 6 noemt dat expliciet fragieler dan een echte capability-check).
 *
 * Gebaseerd op de bekende feature-detectietruc voor module-`Worker`s: een
 * UA die de `type`-optie daadwerkelijk begrijpt LEEST 'm ook (via de getter
 * hieronder, die alleen wordt aangeroepen als de UA de eigenschap
 * daadwerkelijk opvraagt); een UA zonder module-workerondersteuning negeert
 * onbekende opties op een `Worker`-constructor gewoon en roept die getter
 * dus nooit aan. Module-service-workers draaien op dezelfde ES-module-
 * machinery als reguliere `type: 'module'`-workers (§B punt 6: "achter
 * dezelfde ES-module-machinery als reguliere `<script type=\"module\">`"),
 * dus is deze `Worker`-detectie een betrouwbare proxy voor module-SW-
 * ondersteuning — zonder zelf al een service worker te moeten registreren,
 * en dus zonder het "`register()` geeft geen duidelijke throw op alle
 * faalpaden"-risico dat §B punt 6 beschrijft (een module-SW-registratie die
 * gewoon nooit `active` wordt, i.p.v. een zichtbare fout).
 *
 * Retourneert `true` (module-ondersteuning aannemen) wanneer `Worker` hier
 * niet bestaat of de detectie zelf een throw geeft — bewust dezelfde
 * default als het bestaande, ongewijzigde gedrag (`type: 'module'`,
 * `/sw.js`) voor elke omgeving waar deze truc niet uitvoerbaar is (bv.
 * jsdom in componenttests, die geen `Worker`-global heeft) — geen van de
 * bestaande 8.1a-/8.1b-tests hoeft hierdoor te veranderen.
 */
export function detectModuleServiceWorkerSupport(): boolean {
  if (typeof Worker === 'undefined') return true;
  let supportsModule = false;
  const options = {
    get type() {
      supportsModule = true;
      return 'module';
    },
  } as WorkerOptions;
  try {
    const probe = new Worker('data:,', options);
    probe.terminate();
  } catch {
    return true;
  }
  return supportsModule;
}

export type PwaUpdateStatus = 'idle' | 'update-available' | 'reloading' | 'error';

export interface PwaUpdateAdapterState {
  status: PwaUpdateStatus;
  /**
   * PR 8.1b (docs/pr-8.1-plan.md §C 8.1b): of de service-worker-registratie
   * ooit succesvol is afgerond (`register()`'s promise opgelost, ongeacht
   * `status`). Additief bij het bestaande `status`-veld — bestaande
   * consumenten (`PwaUpdateBanner`, `PwaActionNeededPanel`) lezen alleen
   * `status` en blijven ongewijzigd werken. Nodig om `domain/pwa/
   * pwaReadiness.ts`'s `'registering'` (nog geen geslaagde registratie) te
   * onderscheiden van `'ready'` (wél) — de adapter rapporteert beide vandaag
   * als `status: 'idle'`.
   */
  registered: boolean;
}

export type PwaUpdateListener = (state: PwaUpdateAdapterState) => void;

// Hoelang na een bevestigde `SKIP_WAITING` op een `controllerchange` wordt
// gewacht voordat dit als een herstelbare fout (nooit als stille no-op)
// gerapporteerd wordt — zie werk 3/§B punt 5: een blijvend uitblijvende
// `controllerchange` na een bevestigde `skipWaiting`-aanroep is een
// herstelbaar foutscenario binnen hetzelfde `SyncStatus`-diagnosecontract.
export const CONTROLLERCHANGE_TIMEOUT_MS = 15_000;

const IDLE_STATE: PwaUpdateAdapterState = { status: 'idle', registered: false };

/**
 * Reactieve wrapper rond de service-worker-registratie voor de
 * update-detectie-/gecontroleerde-refresh-flow. Geen React/Preact-import
 * hier bewust — dit is de infrastructuurlaag; `application/pwa/
 * usePwaUpdate.ts` is de enige plek die deze klasse aan een hook koppelt.
 */
export class PwaUpdateAdapter {
  private state: PwaUpdateAdapterState = IDLE_STATE;
  private readonly listeners = new Set<PwaUpdateListener>();
  private registration: ServiceWorkerRegistration | null = null;
  private initialized = false;
  private confirmedSkipWaiting = false;
  private reloadRequested = false;
  private controllerChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly boundHandleControllerChange = () => this.handleControllerChange();

  constructor(
    private readonly swUrl = '/sw.js',
    private readonly reload: () => void = () => {
      if (typeof location !== 'undefined') location.reload();
    },
    // 8.1c (§C 8.1c werk 1): pad naar de classic (niet-module) fallback-
    // bundel — zie `vite.config.ts`/`src/sw-classic.ts` voor hoe die apart
    // gebouwd wordt.
    private readonly classicSwUrl = '/sw-classic.js',
    // Injecteerbaar voor testbaarheid (net als `reload`), default de echte
    // capability-check hierboven — geen gedragswijziging voor bestaande
    // aanroepers.
    private readonly supportsModuleServiceWorker: () => boolean = detectModuleServiceWorkerSupport,
  ) {}

  getState(): PwaUpdateAdapterState {
    return this.state;
  }

  subscribe(listener: PwaUpdateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(next: PwaUpdateAdapterState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  /** PR 8.1b: bouwt de volgende state met `registered` afgeleid uit
   * `this.registration !== null` — één bron van waarheid i.p.v. een los
   * bijgehouden vlag die uit de pas kan lopen met de daadwerkelijke
   * registratie. */
  private buildState(status: PwaUpdateStatus): PwaUpdateAdapterState {
    return { status, registered: this.registration !== null };
  }

  /**
   * Registreert de service worker en start de `updatefound`-/
   * `controllerchange`-luisteraars. Idempotent: een tweede aanroep zonder
   * tussentijdse `retry()` is een no-op — voorkomt een dubbele registratie
   * als een aanroeper (bijv. een React StrictMode-dubbelrender) `init()`
   * twee keer aanroept.
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('controllerchange', this.boundHandleControllerChange);

    // 8.1c (§C 8.1c werk 1): de capability-check kiest ÉÉN keer, vóór de
    // registratiepoging zelf, tussen de module-bundel en de classic-
    // fallbackbundel — geen "probeer module, val terug op classic bij een
    // mislukte poging"-keten. Dat is bewust: een module-SW-registratie die
    // niet lukt geeft vaak geen throw (§B punt 6), dus wachten op een
    // gefaalde registratie-promise om te beslissen of classic nodig is zou
    // op precies de apparaten waar dit ertoe doet nooit vuren. Faalt de op
    // basis van deze capability-check GEKOZEN registratie zelf alsnog (bv.
    // een échte netwerk-/scope-fout), dan is dat een aantoonbaar kapotte
    // registratie — werk 2: geen tweede fallbackpoging, gewoon `error`
    // (waarna `domain/pwa/pwaReadiness.ts` dat als `broken` rapporteert).
    const useModule = this.supportsModuleServiceWorker();
    const swUrl = useModule ? this.swUrl : this.classicSwUrl;
    const swType: 'module' | 'classic' = useModule ? 'module' : 'classic';

    navigator.serviceWorker
      .register(swUrl, { scope: '/', type: swType })
      .then((registration) => {
        this.registration = registration;
        // Geslaagde registratie — meteen zichtbaar via `registered: true`,
        // ook als er (nog) geen wachtende update is (PR 8.1b: dit is het
        // signaal dat `domain/pwa/pwaReadiness.ts` onderscheidt van
        // "registering").
        this.setState(this.buildState(registration.waiting ? 'update-available' : 'idle'));
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // Alleen een geïnstalleerde worker MET een reeds bestaande
            // controller is een echte "update beschikbaar" — een eerste
            // installatie (geen concurrerende oude worker) activeert
            // vanzelf zonder wachtstatus, zie sw.ts se eigen commentaar.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              this.setState(this.buildState('update-available'));
            }
          });
        });
      })
      .catch((err) => {
        console.error(`Service worker registratie mislukt (${swType})`, err);
        this.setState(this.buildState('error'));
      });
  }

  private handleControllerChange(): void {
    if (!this.confirmedSkipWaiting) {
      // Een controllerchange die niet volgt op ONZE eigen bevestigde
      // SKIP_WAITING-aanroep (bijv. een andere tab die zelf bijwerkt) mag
      // deze pagina nooit ongevraagd herladen — stopregel §D.
      return;
    }
    this.confirmedSkipWaiting = false;
    if (this.controllerChangeTimer !== null) {
      clearTimeout(this.controllerChangeTimer);
      this.controllerChangeTimer = null;
    }
    if (this.reloadRequested) return; // exact één reload per bevestiging
    this.reloadRequested = true;
    this.reload();
  }

  /**
   * Werk 4 (§C 8.1a): stuurt `{ type: 'SKIP_WAITING' }` naar de wachtende
   * worker en herlaadt de pagina uitsluitend na de daaropvolgende
   * `controllerchange` — nooit een geforceerde reload buiten die volgorde
   * om. Blijft de `controllerchange` uit, dan wordt dat na
   * `CONTROLLERCHANGE_TIMEOUT_MS` als herstelbare fout gerapporteerd
   * (`status: 'error'`) i.p.v. de pagina onbeperkt op "reloading" te laten
   * staan.
   */
  confirmUpdate(): void {
    if (!this.registration?.waiting) return;
    this.confirmedSkipWaiting = true;
    this.reloadRequested = false;
    this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    this.setState(this.buildState('reloading'));
    this.controllerChangeTimer = setTimeout(() => {
      this.controllerChangeTimer = null;
      this.confirmedSkipWaiting = false;
      this.setState(this.buildState('error'));
    }, CONTROLLERCHANGE_TIMEOUT_MS);
  }

  /**
   * Herstelpad voor een mislukte registratie (`status: 'error'`) —
   * bijgehouden via het `PwaActionNeededPanel`-equivalent (§C 8.1a werk 3).
   * Reset en probeert de registratie opnieuw; laat een reeds bevestigde
   * `update-available`/`reloading`-staat ongemoeid (geen zin om een
   * geslaagde registratie te herstarten).
   */
  retry(): void {
    if (this.state.status !== 'error') return;
    this.initialized = false;
    // PR 8.1b: ook de registratieverwijzing zelf terugzetten — anders zou
    // `buildState()` een stale `registered: true` rapporteren na een
    // timeout-fout (registratie was al geslaagd, alleen `controllerchange`
    // bleef uit) terwijl deze retry juist een verse `init()` start.
    this.registration = null;
    this.setState(IDLE_STATE);
    this.init();
  }

  /** Verbergt de foutmelding zonder de onderliggende oorzaak op te lossen —
   * zelfde "Negeren"-semantiek als `ActionNeededPanel.onDismiss`. `buildState`
   * i.p.v. de kale `IDLE_STATE` (PR 8.1b): een timeout-fout ná een
   * bevestigde `skipWaiting`-aanroep kan een reeds geslaagde registratie
   * hebben (`this.registration` niet-`null`) — dat blijft na dismiss
   * zichtbaar als `registered: true` i.p.v. onterecht terug te vallen op
   * `registering`. */
  dismissError(): void {
    if (this.state.status === 'error') this.setState(this.buildState('idle'));
  }
}

// Eén gedeelde instantie voor de hele app-sessie, i.p.v. een nieuwe adapter
// per `usePwaUpdate()`-mount. Vóór 8.1a registreerde `main.tsx` de service
// worker onvoorwaardelijk op het `window`-`load`-event — volledig los van
// login/contextselectie. `usePwaUpdate()` wordt echter pas gemount binnen
// `App`, die zelf pas na login + team-/orgselectie rendert (zie
// `main.tsx`: `render(<AuthGate .../>)` eerst, `App` pas veel later via
// `AuthGate` → `ContextSwitcher`). Zonder een gedeelde singleton die
// `main.tsx` zelf al op `window load` initialiseert, zou de registratie
// dus pas beginnen zodra een gebruiker daadwerkelijk een team opent — een
// regressie op bestaande offline-gereedheidstests
// (`tests/e2e-auth/completed-history-offline-cache.spec.ts`,
// `offline-reload-cache-write-second-client.spec.ts`) die verwachten dat de
// SW al actief kan zijn vóórdat een team ooit geopend is. `main.tsx` roept
// hierop dus zelf `.init()` aan (zie dat bestand's eigen commentaar);
// `usePwaUpdate()` abonneert alleen nog en roept `.init()` als veilige,
// idempotente no-op-achtige fallback aan (bijv. voor toekomstige
// embed-scenario's zonder `main.tsx`).
export const pwaUpdateAdapter = new PwaUpdateAdapter();
