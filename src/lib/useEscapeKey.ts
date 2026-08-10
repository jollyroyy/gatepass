import { useEffect } from 'react';

/**
 * Calls `onEscape` whenever the Escape key is pressed while the caller is
 * mounted. Used by every modal so Escape-to-close is implemented once, not
 * pasted into a dozen components.
 *
 * `active` lets a caller keep the component mounted but temporarily disable
 * the listener (not currently needed anywhere, but cheaper than a second hook
 * the day it is).
 */
export function useEscapeKey(onEscape: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscape();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onEscape, active]);
}
