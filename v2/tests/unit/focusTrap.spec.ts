// @vitest-environment jsdom
//
// PR 8.2a (docs/pr-8.2-plan.md §C 8.2a werk 6): jsdom-unit-tests voor
// `infrastructure/a11y/focusTrap.ts` in isolatie — de e2e-tegenhanger
// (`tests/e2e/a11y-keyboard.spec.ts`) bewijst dezelfde cyclus/restore in een
// echte browser-DOM.
import { afterEach, describe, expect, it } from 'vitest';
import { FocusTrap } from '../../src/infrastructure/a11y/focusTrap';

function mount(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

/** Wacht op de volgende `requestAnimationFrame`-tick — `onFocusOut()` in
 * `focusTrap.ts` plant zijn "is focus echt ontsnapt"-hercheck daarop (niet
 * op een microtask, zie de docstring daar). */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('FocusTrap', () => {
  it('verplaatst focus naar het eerste focusbare element bij activate()', () => {
    const outside = document.createElement('button');
    outside.textContent = 'buiten';
    document.body.appendChild(outside);
    outside.focus();

    const dialog = mount(
      '<div class="modal"><span>geen focusbaar label</span><button data-testid="first">Eerste</button><button data-testid="second">Tweede</button></div>',
    );
    const modal = dialog.querySelector('.modal') as HTMLElement;

    const trap = new FocusTrap();
    trap.activate(modal);

    expect(document.activeElement?.getAttribute('data-testid')).toBe('first');
    trap.deactivate();
  });

  it('negeert geneste, verborgen en disabled elementen bij het bepalen van het eerste focusbare element', () => {
    const dialog = mount(`
      <div class="modal">
        <button data-testid="hidden" style="display:none">Verborgen</button>
        <button data-testid="disabled" disabled>Uitgeschakeld</button>
        <div>
          <button data-testid="nested-visible">Genest, zichtbaar</button>
        </div>
      </div>
    `);
    const modal = dialog.querySelector('.modal') as HTMLElement;

    const trap = new FocusTrap();
    trap.activate(modal);

    expect(document.activeElement?.getAttribute('data-testid')).toBe('nested-visible');
    trap.deactivate();
  });

  it('verplaatst focus naar het dialoog zelf als er geen focusbaar kind is', () => {
    const dialog = mount('<div class="modal"><p>Geen knoppen hier</p></div>');
    const modal = dialog.querySelector('.modal') as HTMLElement;

    const trap = new FocusTrap();
    trap.activate(modal);

    expect(document.activeElement).toBe(modal);
    expect(modal.getAttribute('tabindex')).toBe('-1');
    trap.deactivate();
  });

  it('laat Tab cyclen van het laatste naar het eerste focusbare element', () => {
    const dialog = mount(
      '<div class="modal"><button data-testid="a">A</button><button data-testid="b">B</button></div>',
    );
    const modal = dialog.querySelector('.modal') as HTMLElement;
    const buttons = Array.from(modal.querySelectorAll('button'));
    const a = buttons[0] as HTMLElement;
    const b = buttons[1] as HTMLElement;

    const trap = new FocusTrap();
    trap.activate(modal);

    b.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    modal.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a);
    trap.deactivate();
  });

  it('laat Shift+Tab cyclen van het eerste naar het laatste focusbare element', () => {
    const dialog = mount(
      '<div class="modal"><button data-testid="a">A</button><button data-testid="b">B</button></div>',
    );
    const modal = dialog.querySelector('.modal') as HTMLElement;
    const buttons = Array.from(modal.querySelectorAll('button'));
    const a = buttons[0] as HTMLElement;
    const b = buttons[1] as HTMLElement;

    const trap = new FocusTrap();
    trap.activate(modal);

    a.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    modal.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(b);
    trap.deactivate();
  });

  it('laat Tab tussen twee middelste elementen ongemoeid (geen preventDefault)', () => {
    const dialog = mount(
      '<div class="modal"><button data-testid="a">A</button><button data-testid="b">B</button><button data-testid="c">C</button></div>',
    );
    const modal = dialog.querySelector('.modal') as HTMLElement;
    const a = modal.querySelector('button') as HTMLElement;

    const trap = new FocusTrap();
    trap.activate(modal);

    a.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    modal.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    trap.deactivate();
  });

  it('herstelt focus naar het onthouden element bij deactivate()', () => {
    const opener = document.createElement('button');
    opener.setAttribute('data-testid', 'opener');
    document.body.appendChild(opener);
    opener.focus();

    const dialog = mount('<div class="modal"><button data-testid="first">Eerste</button></div>');
    const modal = dialog.querySelector('.modal') as HTMLElement;

    const trap = new FocusTrap();
    trap.activate(modal);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('first');

    trap.deactivate();
    expect(document.activeElement).toBe(opener);
  });

  it('herstelt geen focus als het onthouden element niet meer in de DOM zit', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const dialog = mount('<div class="modal"><button data-testid="first">Eerste</button></div>');
    const modal = dialog.querySelector('.modal') as HTMLElement;

    const trap = new FocusTrap();
    trap.activate(modal);

    opener.remove();

    expect(() => trap.deactivate()).not.toThrow();
  });

  it('trekt focus terug binnen container zodra het buiten container terechtkomt zonder een Tab-toetsaanslag (bijv. dynamisch disabled)', () => {
    // Regressie uit externe review PR #81: `TakeoverConfirmDialog` zet
    // beide knoppen `disabled` tijdens `inProgress`, waardoor Chromium de
    // gefocuste knop zelf, zonder Tab-toetsaanslag, defocust naar `<body>`
    // — een listener die alleen aan `container` hing miste dat. jsdom
    // volgt dat specifieke `disabled`-defocusgedrag niet (geverifieerd),
    // dus simuleert deze test het geobserveerde eindresultaat generiek:
    // focus komt via een `focusin` buiten `container` terecht, zonder Tab.
    // `document`-brede `focusin`-afvang (`onFocusIn`) moet dat herstellen.
    const outside = document.createElement('button');
    outside.setAttribute('data-testid', 'outside');
    document.body.appendChild(outside);

    const dialog = mount(
      '<div class="modal"><button data-testid="confirm">Bevestig</button></div>',
    );
    const modal = dialog.querySelector('.modal') as HTMLElement;
    const confirmBtn = modal.querySelector('button') as HTMLButtonElement;

    const trap = new FocusTrap();
    trap.activate(modal);
    expect(document.activeElement).toBe(confirmBtn);

    outside.focus();
    expect(document.activeElement).not.toBe(outside);
    expect(document.activeElement).toBe(confirmBtn);

    trap.deactivate();
  });

  it('trekt focus terug binnen container als het element verdwijnt naar buiten zonder ENIGE focusin (echte disabled-quirk)', async () => {
    // Tweede-ronde regressie uit externe review PR #81: empirisch tegen
    // echte Chromium geverifieerd dat het disablen van het gefocuste
    // element `document.activeElement` synchroon op `<body>` zet, met
    // uitsluitend een `focusout` op het oude element — GEEN enkel
    // `focusin`-event volgt daarna. De test hierboven ("... bijv. dynamisch
    // disabled") simuleerde dat eerder via `outside.focus()`, wat in jsdom
    // wél een echte `focusin` vuurt — dus bewees het `onFocusIn`-pad, niet
    // dit specifieke gat. Hier wordt het element `blur()`t (jsdom vuurt dan,
    // net als Chromium's disabled-quirk, alleen `focusout` en verplaatst
    // `activeElement` naar `<body>`, zonder enig `focusin`-event —
    // geverifieerd: jsdom past `activeElement` bij `disabled = true` zelf
    // niet aan, dus dat exacte attribuutpad is hier niet te simuleren; kale
    // `blur()` geeft wel exact hetzelfde eventpatroon dat de fix moet
    // afvangen), zodat dit specifiek het `onFocusOut()`-vangnet bewijst.
    const dialog = mount(
      '<div class="modal"><button data-testid="confirm">Bevestig</button></div>',
    );
    const modal = dialog.querySelector('.modal') as HTMLElement;
    const confirmBtn = modal.querySelector('button') as HTMLButtonElement;

    const trap = new FocusTrap();
    trap.activate(modal);
    expect(document.activeElement).toBe(confirmBtn);

    confirmBtn.blur();
    // Onmiddellijk na blur() staat activeElement op <body> (of null) — dat
    // is exact het tussenbeeld dat een synchrone check niet mag afvangen
    // (zie de docstring bij onFocusOut()).
    expect(document.activeElement).not.toBe(confirmBtn);

    await nextFrame(); // laat de requestAnimationFrame()-hercheck in onFocusOut() lopen

    // confirmBtn blijft hier (anders dan de echte TakeoverConfirmDialog-
    // regressie) gewoon focusbaar — focusFirstOrContainer() pakt 'm dus
    // opnieuw als eerste focusbare kind, niet de container zelf. De
    // container-fallback wordt al apart bewezen door de eerstvolgende test
    // hieronder ("... geen focusbaar kind meer over is").
    expect(document.activeElement).toBe(confirmBtn);
    trap.deactivate();
  });

  it('valt terug op de container zelf wanneer focus zonder focusin verdwijnt ÉN geen enkel kind meer focusbaar is (TakeoverConfirmDialog tijdens inProgress)', async () => {
    // Spiegelt de exacte externe-reviewrepro: beide dialoogknoppen worden
    // tegelijk `disabled`, dus is er na de focusverplaatsing geen focusbaar
    // kind meer over — `focusFirstOrContainer()` moet dan op de container
    // zelf uitkomen (net als het bestaande "geen focusbaar kind"-Tab-pad
    // hieronder), niet op `<body>` blijven staan.
    const dialog = mount(
      '<div class="modal"><button data-testid="confirm">Bevestig</button><button data-testid="cancel">Annuleren</button></div>',
    );
    const modal = dialog.querySelector('.modal') as HTMLElement;
    const confirmBtn = modal.querySelector('[data-testid="confirm"]') as HTMLButtonElement;
    const cancelBtn = modal.querySelector('[data-testid="cancel"]') as HTMLButtonElement;

    const trap = new FocusTrap();
    trap.activate(modal);
    expect(document.activeElement).toBe(confirmBtn);

    confirmBtn.blur(); // simuleert de focusout-naar-<body>-quirk (zie hierboven)
    confirmBtn.disabled = true;
    cancelBtn.disabled = true; // beide knoppen disabled, zoals TakeoverConfirmDialog tijdens inProgress

    await nextFrame();

    expect(document.activeElement).toBe(modal);
    expect(modal.getAttribute('tabindex')).toBe('-1');
    trap.deactivate();
  });

  it('verstoort een legitieme focusverplaatsing naar een ANDER element binnen container niet (P1-regressie, derde ronde externe review PR #81)', async () => {
    // De eerste `onFocusOut()`-fix (op `queueMicrotask()`) brak gewone Tab-
    // navigatie tussen twee middelste knoppen: tegen echte Chromium bleek
    // dat een ECHTE, toetsenbord-gedreven Tab-navigatie eerst alle
    // microtasks leegt en pas DAARNA de `focusin` op het nieuwe element
    // vuurt — een microtask-check zag dan nog `<body>`, concludeerde ten
    // onrechte "focus ontsnapt", en trok focus terug naar het EERSTE
    // element, ook al was de Tab-navigatie zelf prima gelukt. Dit is de
    // reden voor `requestAnimationFrame` i.p.v. `queueMicrotask` in
    // `onFocusOut()`. jsdom kan die exacte browsertiming niet nabootsen
    // (vandaar de e2e-tegenhanger met échte `page.keyboard.press('Tab')` in
    // `game-sync-takeover.spec.ts`), maar dit bewijst op z'n minst dat een
    // legitieme `.focus()`-verplaatsing naar een ANDER, nog steeds
    // focusbaar kind binnen `container` — hier vóór de volgende
    // `requestAnimationFrame`-tick — niet ongedaan gemaakt wordt.
    const dialog = mount(
      '<div class="modal"><button data-testid="a">A</button><button data-testid="b">B</button></div>',
    );
    const modal = dialog.querySelector('.modal') as HTMLElement;
    const a = modal.querySelector('[data-testid="a"]') as HTMLButtonElement;
    const b = modal.querySelector('[data-testid="b"]') as HTMLButtonElement;

    const trap = new FocusTrap();
    trap.activate(modal);
    expect(document.activeElement).toBe(a);

    b.focus(); // legitieme verplaatsing binnen container, geen Tab-toetsaanslag nodig

    await nextFrame();

    expect(document.activeElement).toBe(b);
    trap.deactivate();
  });

  it('houdt Tab binnen container gevangen als er geen focusbaar kind meer over is', () => {
    const dialog = mount(
      '<div class="modal"><button data-testid="confirm" disabled>Bevestig</button></div>',
    );
    const modal = dialog.querySelector('.modal') as HTMLElement;

    const trap = new FocusTrap();
    trap.activate(modal);
    expect(document.activeElement).toBe(modal);

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    modal.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(modal);

    trap.deactivate();
  });

  it('is idempotent: een tweede activate()/deactivate() zonder toestandswijziging is een no-op', () => {
    const dialog = mount('<div class="modal"><button data-testid="first">Eerste</button></div>');
    const modal = dialog.querySelector('.modal') as HTMLElement;

    const trap = new FocusTrap();
    trap.activate(modal);
    const opener = document.activeElement;
    trap.activate(modal); // tweede aanroep, zelfde container: no-op

    expect(document.activeElement).toBe(opener);

    trap.deactivate();
    trap.deactivate(); // tweede aanroep: no-op, geen throw
  });
});
