import { useEffect, useState } from 'react';
import { gp } from '../supabaseClient';

/** Undefined while checking, false on any failed read. The RPC is the authority. */
export function useCanPrintPass(passId: string | null | undefined, refreshKey?: unknown): boolean | undefined {
  const [allowed, setAllowed] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!passId) { setAllowed(false); return undefined; }
    let cancelled = false;
    setAllowed(undefined);
    void (async () => {
      try {
        const { data, error } = await gp().rpc('can_print_pass', { p_pass_id: passId });
        if (!cancelled) setAllowed(!error && data === true);
      } catch {
        if (!cancelled) setAllowed(false);
      }
    })();
    return () => { cancelled = true; };
  }, [passId, refreshKey]);

  return allowed;
}

export async function canPrintPassNow(passId: string): Promise<boolean> {
  try {
    const { data, error } = await gp().rpc('can_print_pass', { p_pass_id: passId });
    return !error && data === true;
  } catch {
    return false;
  }
}
