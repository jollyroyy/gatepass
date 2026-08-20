// The department deletion requests this reader is entitled to (migration 060).
//
// ONE RPC, and it answers differently for different people by design: an admin
// gets every request, an HOD gets the ones raised against a department they
// actively head, and anybody else gets an empty list rather than a refusal —
// the HOD dashboard renders this card for every HOD, and an error where there
// is simply nothing waiting would be a broken-looking screen.
//
// A FAILED READ IS AN EMPTY LIST. This card sits on a board whose figures come
// from somewhere else entirely; a lookup that falls over must not take the
// dashboard with it.
import { useCallback, useEffect, useState } from 'react';
import { gp } from '../supabaseClient';
import type { DepartmentDeleteRequest } from './departmentDeleteRequests';

export function useDepartmentDeleteRequests(enabled = true): {
  requests: DepartmentDeleteRequest[];
  loading: boolean;
  reload: () => Promise<void>;
} {
  const [requests, setRequests] = useState<DepartmentDeleteRequest[]>([]);
  const [loading, setLoading] = useState(enabled);

  const reload = useCallback(async () => {
    if (!enabled) {
      setRequests([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await gp().rpc('list_department_delete_requests');
      if (error) {
        setRequests([]);
        return;
      }
      setRequests((data as DepartmentDeleteRequest[] | null) ?? []);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { requests, loading, reload };
}

/**
 * The HOD's decision. Approving is what DELETES the department — 060 performs
 * the deletion inside the same call, so there is no second press for anybody
 * to forget (the client chose this over "the admin confirms afterwards").
 *
 * Throws on refusal, so the caller shows the database's own sentence.
 */
export async function decideDepartmentDeletion(
  requestId: string,
  approve: boolean,
  reason: string,
): Promise<void> {
  const { error } = await gp().rpc('hod_decide_department_deletion', {
    p_request_id: requestId,
    p_approve: approve,
    p_reason: reason,
  });
  if (error) throw error;
}
