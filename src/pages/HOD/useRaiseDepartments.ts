// WHICH DEPARTMENTS THE RAISE FORM MAY RAISE FOR, and whether the reader picks.
//
// Two readers, two answers, one screen (client, 2026-08-31: the COO and the CEO
// raise "on behalf of any department", on "those forms exactly as the hod sees
// it except one thing that ceo and coo can select the department"):
//
//   * AN HOD gets the department they head — one row, resolved from
//     `gatepass.hod_departments` (032: one department per person) and joined to
//     VMS's `public.departments` for the name and the code. It is never asked
//     for; the form selects it silently and the mock-up has no field for it.
//   * A COO OR CEO gets EVERY department, and NOTHING IS PRE-SELECTED. They
//     head none of these, so defaulting to the alphabetically first one is how
//     a pass gets raised against a department nobody chose.
//
// Split out of `RaisePass.tsx` for the 300-line cap, which the second branch
// pushed it over. The seam is real enough: this is the one question whose
// answer differs between the two forms, and everything the form does with the
// answer is identical.
//
// A FAILED READ IS AN ERROR MESSAGE, not an empty list quietly offered as a
// choice — an empty selector and "you are assigned to no department" are
// different facts, and `validateRaiseForm` already has a sentence for the
// second one.
//
// THE SERVER RE-CHECKS THE CHOICE REGARDLESS. `raise_pass` (069) admits a
// department id only from `my_department_ids()` for an HOD, or any real one for
// the sitting COO/CEO, so nothing here is a security boundary — `public.
// departments` is readable by every authenticated user under VMS's own policy
// (verified against the live project, 2026-08-31).
import { useEffect, useState } from 'react';
import { gp, pub } from '../../supabaseClient';
import type { DeptOption } from '../../types';
import { safeErrorMessage } from '../../lib/errors';

export interface RaiseDepartments {
  depts: DeptOption[];
  /** The one department to select on load, or null when the reader must pick. */
  autoSelect: string | null;
  error: string | null;
}

export function useRaiseDepartments(
  picksDepartment: boolean,
  // 077: THE ONE DEPARTMENT AN AUTHORISED RAISER MAY RAISE FOR, handed down
  // from `my_raising_grant()`. A third reader with a third answer, and the
  // narrowest of the three: not chosen (they head nothing to choose from) and
  // not looked up in `hod_departments` (they are not an HOD), but named by the
  // authority itself. The row is still READ from `public.departments`, because
  // the form needs the CODE for 074's reference number and the grant carries
  // only the name.
  fixedDepartmentId: string | null = null,
): RaiseDepartments {
  const [depts, setDepts] = useState<DeptOption[]>([]);
  const [autoSelect, setAutoSelect] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (fixedDepartmentId) {
          const { data, error: oneErr } = await pub()
            .from('departments')
            .select('id, name, code')
            .eq('id', fixedDepartmentId);
          if (oneErr) throw oneErr;
          if (cancelled) return;
          const list = (data ?? []) as DeptOption[];
          setDepts(list);
          if (list.length > 0) setAutoSelect(list[0].id);
          return;
        }

        if (picksDepartment) {
          const { data, error: allErr } = await pub()
            .from('departments')
            .select('id, name, code')
            .order('name');
          if (allErr) throw allErr;
          if (!cancelled) setDepts((data ?? []) as DeptOption[]);
          return;
        }

        const { data: hodDepts, error: hodErr } = await gp()
          .from('hod_departments')
          .select('department_id');
        if (hodErr) throw hodErr;
        const ids = (hodDepts ?? []).map((r: { department_id: string }) => r.department_id);
        if (ids.length === 0) {
          if (!cancelled) setDepts([]);
          return;
        }

        const { data: deptRows, error: deptErr } = await pub()
          .from('departments')
          .select('id, name, code')
          .in('id', ids);
        if (deptErr) throw deptErr;
        if (cancelled) return;
        const list = (deptRows ?? []) as DeptOption[];
        setDepts(list);
        if (list.length > 0) setAutoSelect(list[0].id);
      } catch (err) {
        if (!cancelled) setError(safeErrorMessage(err));
      }
    }
    load();
    return () => { cancelled = true; };
  }, [picksDepartment, fixedDepartmentId]);

  return { depts, autoSelect, error };
}
