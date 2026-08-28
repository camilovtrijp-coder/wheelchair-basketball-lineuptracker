// PR 8.2a (docs/pr-8.2-plan.md §C 8.2a werk 2/§B punt 2): focus-trap voor
// modale dialogen. Pure DOM-API, geen Preact-import in deze laag — zelfde
// regel als `infrastructure/pwa/PwaUpdateAdapter.ts`. `application/a11y/
// useFocusTrap.ts` is de enige plek die deze klasse aan een Preact-`ref`
// koppelt.
//
// Drie modals (`ModalDialog.tsx`, `GamesFilterModal.tsx` — die ModalDialog
// hergebruikt —, `TakeoverConfirmDialog.tsx`) hebben vandaag dezelfde
// behoefte (focus vangen bij openen, Tab laten cyclen binnen het dialoog,
// focus teruggeven bij sluiten) maar geen van drieën heeft die logica —
// alleen backdrop-click/Escape sluiten het dialoog. Eén gedeelde
// implementatie i.p.v. drie losse ad-hoc-varianten.

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Een element telt alleen als focusbaar als het (en elke voorouder) ook
 * daadwerkelijk zichtbaar is — een expliciete stijl-/`hidden`-attribuutwalk
 * i.p.v. `offsetParent` (die in jsdom, gebruikt door de unit-tests naast dit
 * bestand, altijd `null` teruggeeft ongeacht daadwerkelijke zichtbaarheid —
 * `offsetParent` zou daar dus élk element als "verborgen" beoordelen). */
function isRendered(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    if (node.hidden) return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    node = node.parentElement;
  }
  return true;
}

function queryFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isRendered);
}

/**
 * Vangt en herstelt focus binnen `container` zolang de trap actief is.
 * Levenscyclus: `activate()` bij het openen van een dialoog, `deactivate()`
 * bij het sluiten — beide idempotent (een dubbele `activate()`/
 * `deactivate()`-aanroep zonder tussenliggende toestandswijziging is een
 * no-op).
 */
export class FocusTrap {
  private container: HTMLElement | null = null;
  private previouslyFocused: HTMLElement | null = null;
  private active = false;
  private pendingFocusOutCheck: number | null = null;
  private readonly handleKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
  private readonly handleFocusIn = (e: FocusEvent) => this.onFocusIn(e);
  private readonly handleFocusOut = () => this.onFocusOut();

  /**
   * (a) onthoudt het element dat op dit moment focus heeft (voor restore
   * bij `deactivate()`), (b) verplaatst focus naar het eerste focusbare
   * element binnen `container` (of `container` zelf als er geen focusbaar
   * kind is — zodat Tab/Escape sowieso binnen het dialoog blijven werken).
   *
   * Drie listeners hangen op `document`, niet op `container`: focus die naar
   * buiten `container` "lekt" zonder Tab (bijv. `TakeoverConfirmDialog`
   * tijdens `inProgress`, waar beide knoppen dynamisch `disabled` worden)
   * vuurt geen event meer op `container` zelf. `keydown`/`focusin` vangen het
   * geval waarin een ANDER element buiten `container` daadwerkelijk focus
   * krijgt. `focusout` (+ `onFocusOut()` hieronder) vangt het aparte,
   * geverifieerde Chromium-gedrag waarbij het gefocuste element `disabled`
   * wordt: `document.activeElement` springt dan naar `<body>` en er vuurt
   * GEEN enkel `focusin`-event — alleen een `focusout` op het oude element
   * (herhaaldelijk gereproduceerd tegen echte Chromium tijdens externe
   * review op PR #81, tweede ronde: `focusin`-only miste dit specifieke
   * geval nog steeds).
   */
  activate(container: HTMLElement): void {
    if (this.active && this.container === container) return;
    this.container = container;
    this.previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.active = true;
    document.addEventListener('keydown', this.handleKeyDown, true);
    document.addEventListener('focusin', this.handleFocusIn, true);
    document.addEventListener('focusout', this.handleFocusOut, true);

    this.focusFirstOrContainer();
  }

  /** (d) zet focus terug naar het onthouden element — een no-op als dat
   * element niet meer in de DOM zit (bv. een intussen verwijderde rij), in
   * plaats van een throw of een stille focus-op-`<body>`. */
  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener('keydown', this.handleKeyDown, true);
    document.removeEventListener('focusin', this.handleFocusIn, true);
    document.removeEventListener('focusout', this.handleFocusOut, true);
    if (this.pendingFocusOutCheck !== null) {
      cancelAnimationFrame(this.pendingFocusOutCheck);
      this.pendingFocusOutCheck = null;
    }
    this.container = null;
    if (this.previouslyFocused && document.contains(this.previouslyFocused)) {
      this.previouslyFocused.focus();
    }
    this.previouslyFocused = null;
  }

  private focusFirstOrContainer(): void {
    if (!this.container) return;
    const [first] = queryFocusable(this.container);
    if (first) {
      first.focus();
    } else {
      if (!this.container.hasAttribute('tabindex')) this.container.setAttribute('tabindex', '-1');
      this.container.focus();
    }
  }

  /** Snel pad: vangt een focusverplaatsing waarbij een ANDER element buiten
   * `container` daadwerkelijk (synchroon) focus krijgt — bijv. een script
   * dat ergens buiten het dialoog `.focus()` aanroept. Trekt focus meteen
   * terug, zonder op de `focusout`-microtask hieronder te hoeven wachten.
   * Vangt NIET het "focus verdwijnt naar `<body>` zonder enig focusin"-geval
   * (zie `onFocusOut()`) — dat is precies waarom beide listeners bestaan. */
  private onFocusIn(e: FocusEvent): void {
    if (!this.container) return;
    const target = e.target;
    if (target instanceof Node && this.container.contains(target)) return;
    this.focusFirstOrContainer();
  }

  /**
   * Vangnet voor het geverifieerde Chromium-gedrag waarbij het gefocuste
   * element `disabled` wordt: `document.activeElement` is dan DIRECT
   * (synchroon, binnen deze `focusout`-handler) al `<body>`, maar er volgt
   * daarna GEEN `focusin`-event — `onFocusIn()` hierboven kan dit dus per
   * definitie niet vangen.
   *
   * Waarom `requestAnimationFrame`, en niet `queueMicrotask` (P1-fix, derde
   * ronde externe review PR #81 — de tweede fixpoging hierboven bleek zelf
   * ook nog onvolledig): een normale, legitieme focusverplaatsing (bijv. Tab
   * tussen twee knoppen in `container`) toont `document.activeElement` op
   * het moment van `focusout` OOK al als leeg/`<body>` — dat is hoe de
   * browser focuswissels intern verwerkt, eerst `focusout` op het oude
   * element, dán pas `focusin` op het nieuwe. Voor een PROGRAMMATISCHE
   * `.focus()`-aanroep gebeurt die tweede stap nog synchroon, in dezelfde
   * taak, dus zou een `queueMicrotask()`-check die net op tijd zien. Voor
   * een ECHTE, TOETSENBORD-gedreven Tab-navigatie (waar de browser de
   * standaard fs-navigatie afhandelt, niet deze klasse se eigen
   * `onKeyDown()` — die grijpt alleen in bij de dialooggrenzen, zie
   * hieronder) bleek tegen echte Chromium empirisch dat de browser eerst
   * ALLE microtasks leegt en pas DAARNA de `focusin` op het nieuwe element
   * vuurt — een `queueMicrotask()`-check zag dan nog `<body>`, concludeerde
   * ten onrechte "focus ontsnapt", en trok focus terug naar het EERSTE
   * element — waardoor gewone Tab-navigatie binnen het dialoog zelf kapot
   * ging (gereproduceerd: Tab van knop 1 naar knop 2 bleef op knop 1
   * hangen). `requestAnimationFrame` draait pas ná de volgende paint-cyclus
   * — ruim genoeg voor beide gevallen: geverifieerd dat de browser tegen
   * die tijd voor de Tab-navigatie het nieuwe element al daadwerkelijk
   * gefocust heeft, terwijl de disabled-quirk (waar nooit een focusin volgt)
   * op dat moment nog steeds op `<body>` staat. Beide gedragingen empirisch
   * geverifieerd tegen echte Chromium (niet jsdom, dat de browserspecifieke
   * timing niet exact nabootst, al ondersteunt jsdom `requestAnimationFrame`
   * zelf wel — zie `focusTrap.spec.ts`).
   */
  private onFocusOut(): void {
    if (!this.active) return;
    if (this.pendingFocusOutCheck !== null) cancelAnimationFrame(this.pendingFocusOutCheck);
    this.pendingFocusOutCheck = requestAnimationFrame(() => {
      this.pendingFocusOutCheck = null;
      if (!this.active || !this.container) return;
      const active = document.activeElement;
      if (active instanceof Node && this.container.contains(active)) return;
      this.focusFirstOrContainer();
    });
  }

  /** (c) laat Tab/Shift+Tab binnen de focusbare kinderen van `container`
   * cyclen — geen focus die naar de achtergrondpagina "lekt" terwijl het
   * dialoog open is. */
  private onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !this.container) return;
    const focusable = queryFocusable(this.container);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }

    // Beide bestaan gegarandeerd: de lege-array-tak hierboven is al
    // afgehandeld met een `return`.
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    const current = document.activeElement;

    if (e.shiftKey) {
      if (current === first || !focusable.includes(current as HTMLElement)) {
        e.preventDefault();
        last.focus();
      }
    } else if (current === last || !focusable.includes(current as HTMLElement)) {
      e.preventDefault();
      first.focus();
    }
  }
}
