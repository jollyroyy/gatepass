// Shared by all three dashboards (GuardDashboard, HOD Dashboard) so a KPI
// click brings the revealed drill list into view instead of leaving it below
// the fold. Defined once — do not copy-paste this into each dashboard.
//
// Deliberately does NOT scroll on first mount: a page that jumps on load is
// worse than one that doesn't scroll at all. It only fires when `key` changes
// to a different value after the initial render.
import { useEffect, useRef, type RefObject } from 'react';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Returns a ref to attach to the results container. Whenever `key` changes
 * (e.g. the selected drill), the element is scrolled smoothly to the top of
 * the viewport — falling back to instant scroll under prefers-reduced-motion.
 *
 * `scrollIntoView` does not exist in jsdom, so it is called defensively.
 */
export function useScrollIntoViewOnChange<T extends HTMLElement>(key: unknown): RefObject<T> {
  const ref = useRef<T>(null);
  const isFirstRender = useRef(true);
  const prevKey = useRef(key);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevKey.current = key;
      return;
    }
    if (key === prevKey.current) return;
    prevKey.current = key;

    const el = ref.current;
    if (!el || typeof el.scrollIntoView !== 'function') return;

    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, [key]);

  return ref;
}
