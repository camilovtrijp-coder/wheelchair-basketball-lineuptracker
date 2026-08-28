// PR 8.2a (docs/pr-8.2-plan.md §C 8.2a werk 3/§B punt 2): Preact-hook die
// `infrastructure/a11y/FocusTrap` aan een dialoog-DOM-node koppelt via een
// `ref` — zelfde plaats-in-de-laag-conventie als
// `application/pwa/usePwaUpdate.ts` (een hook in de applicatielaag rond een
// infrastructuuradapter).
import { useEffect, useRef } from 'preact/hooks';
import { FocusTrap } from '../../infrastructure/a11y/focusTrap';

/**
 * `active`: of de trap op dit moment moet vangen — een aanroeper geeft
 * doorgaans `true` door zolang het dialoog gemount/open is. Activeert bij
 * mount (of zodra `active` van `false` naar `true` gaat) en deactiveert
 * (focus-restore) bij unmount of zodra `active` weer `false` wordt.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T | null>(null);
  const trapRef = useRef<FocusTrap | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const trap = new FocusTrap();
    trapRef.current = trap;
    trap.activate(container);

    return () => {
      trap.deactivate();
      trapRef.current = null;
    };
  }, [active]);

  return containerRef;
}
