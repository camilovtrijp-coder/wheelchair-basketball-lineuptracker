import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';

/**
 * Bladerwiel (scroll-snap) voor het Snel-wedstrijdscherm: één kolom met waarden
 * waarvan de middelste is gekozen. Bediening: scrollen/vegen, een waarde
 * aantikken, of pijltjes omhoog/omlaag (Home/End naar de uiteinden). Alleen
 * UI; de aanroeper bepaalt wat er met de gekozen index gebeurt.
 *
 * `index` is de waarheid: verandert de aanroeper die (bijvoorbeeld bij een
 * tijdsbijstelling), dan scrollt het wiel er direct heen zonder `onChange` terug
 * te roepen.
 */
export interface WheelPickerProps {
  values: string[];
  index: number;
  onChange: (index: number) => void;
  ariaLabel: string;
  testId: string;
  disabled?: boolean;
}

const FALLBACK_ITEM_HEIGHT = 44;

function itemHeight(el: HTMLElement): number {
  const item = el.querySelector<HTMLElement>('[role="option"]');
  return item != null && item.offsetHeight > 0 ? item.offsetHeight : FALLBACK_ITEM_HEIGHT;
}

function clampIndex(i: number, length: number): number {
  return Math.max(0, Math.min(length - 1, i));
}

function scrollTo(el: HTMLElement, top: number, smooth: boolean): void {
  if (typeof el.scrollTo === 'function') {
    el.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  } else {
    el.scrollTop = top;
  }
}

export function WheelPicker({
  values,
  index,
  onChange,
  ariaLabel,
  testId,
  disabled = false,
}: WheelPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Laatst getoonde index: komt uit een scrollgebaar of uit de prop.
  const shown = useRef(index);
  const frame = useRef(0);

  // Startpositie vóór de eerste paint.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = clampIndex(index, values.length) * itemHeight(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alleen bij mount
  }, []);

  // Externe wijziging van `index`: wiel meebewegen.
  useEffect(() => {
    const el = ref.current;
    if (el == null || index === shown.current) return;
    shown.current = index;
    scrollTo(el, clampIndex(index, values.length) * itemHeight(el), false);
  }, [index, values.length]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function handleScroll() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = ref.current;
      if (el == null) return;
      const i = clampIndex(Math.round(el.scrollTop / itemHeight(el)), values.length);
      if (i !== shown.current) {
        shown.current = i;
        onChange(i);
      }
    });
  }

  function choose(i: number, smooth: boolean) {
    const el = ref.current;
    const next = clampIndex(i, values.length);
    if (el != null) scrollTo(el, next * itemHeight(el), smooth);
    if (next !== shown.current) {
      shown.current = next;
      onChange(next);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (disabled) return;
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = index + 1;
    else if (e.key === 'ArrowUp') next = index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = values.length - 1;
    if (next == null) return;
    e.preventDefault();
    choose(next, true);
  }

  // Aantikken van een waarde: via de (focusbare) lijst, zodat de opties zelf geen klikhandler nodig hebben.
  function handleClick(e: MouseEvent) {
    if (disabled) return;
    const item = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
    const i = item != null ? Number(item.dataset.index) : Number.NaN;
    if (Number.isInteger(i)) choose(i, true);
  }

  return (
    <div className="quick-wheel" data-testid={testId}>
      <div
        className="quick-wheel__scroll"
        ref={ref}
        role="listbox"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-activedescendant={`${testId}-opt-${index}`}
        data-value={values[index] ?? ''}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
      >
        {values.map((label, i) => (
          <div
            key={label}
            id={`${testId}-opt-${i}`}
            role="option"
            aria-selected={i === index}
            className={
              i === index ? 'quick-wheel__item quick-wheel__item--on' : 'quick-wheel__item'
            }
            data-index={i}
            data-testid={`${testId}-opt-${i}`}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="quick-wheel__band" aria-hidden="true" />
    </div>
  );
}
