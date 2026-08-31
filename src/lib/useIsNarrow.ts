// IS THE READER ON A PHONE? — asked once, in one place.
//
// A wide data table inside `overflow-x: auto` does not "shrink" on a 390px
// screen: it keeps its width and hides everything past the first two columns
// behind a horizontal scroll nobody discovers. The Pending OUT queue's ELEVENTH
// column is Approve OUT, which is how a guard cleared a truck out of the
// building — on a phone that button was simply not there (client, 2026-08-31).
//
// The alternative, drawing both layouts and letting a Tailwind `lg:hidden`
// choose, doubles every row in the DOM and every item query a row can start.
// This asks the browser instead, so exactly ONE layout exists at a time.
//
// It answers FALSE when `matchMedia` is missing (jsdom, and any pre-paint
// render): the table is the fuller layout, so an unknown viewport gets the
// layout that loses nothing.
import { useEffect, useState } from 'react';

/** Below Tailwind's `lg`. The guard's tables are readable at 1024px and not
 *  below it, so this is the same seam the CSS would have used. */
export const NARROW_QUERY = '(max-width: 1023px)';

function readMatch(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export default function useIsNarrow(query: string = NARROW_QUERY): boolean {
  const [narrow, setNarrow] = useState(() => readMatch(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(query);
    } catch {
      return;
    }
    const onChange = (): void => setNarrow(mql.matches);
    onChange();
    // Safari below 14 has `addListener` only; the app is installed on phones
    // that old, so the fallback is not decoration.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = mql as any;
    legacy.addListener?.(onChange);
    return () => legacy.removeListener?.(onChange);
  }, [query]);

  return narrow;
}
