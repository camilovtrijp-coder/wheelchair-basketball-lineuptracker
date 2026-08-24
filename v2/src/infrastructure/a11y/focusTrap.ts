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
  private readonly handleKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);

  /**
   * (a) onthoudt het element dat op dit moment focus heeft (voor restore
   * bij `deactivate()`), (b) verplaatst focus naar het eerste focusbare
   * element binnen `container` (of `container` zelf als er geen focusbaar
   * kind is — zodat Tab/Escape sowieso binnen het dialoog blijven werken).
   */
  activate(container: HTMLElement): void {
    if (this.active && this.container === container) return;
    this.container = container;
    this.previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.active = true;
    container.addEventListener('keydown', this.handleKeyDown);

    const [first] = queryFocusable(container);
    if (first) {
      first.focus();
    } else {
      if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
      container.focus();
    }
  }

  /** (d) zet focus terug naar het onthouden element — een no-op als dat
   * element niet meer in de DOM zit (bv. een intussen verwijderde rij), in
   * plaats van een throw of een stille focus-op-`<body>`. */
  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.container?.removeEventListener('keydown', this.handleKeyDown);
    this.container = null;
    if (this.previouslyFocused && document.contains(this.previouslyFocused)) {
      this.previouslyFocused.focus();
    }
    this.previouslyFocused = null;
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
