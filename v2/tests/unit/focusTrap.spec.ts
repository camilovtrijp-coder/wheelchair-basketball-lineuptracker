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
