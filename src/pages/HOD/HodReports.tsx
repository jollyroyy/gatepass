// The HOD's Reports tab (2026-08-20, client: "the same report tab section you
// built for the admin — exactly the same type of thing, front-end design and
// everything — do it for the listing for all the HODs too, but only for their
// own department. Remove the Department and Raised By columns for an
// individual HOD, both from the column header and from the filter section.")
//
// THIS IS A WRAPPER, NOT A COPY, on purpose — one register, not two that could
// drift apart the next time the mock-up changes. `ReportsPage` (the admin's
// screen at `/all-passes`) already reads `v_gate_passes` with a bare
// `select('*')` and no department filter; it does not need one HERE either,
// because the client's "only for their own department" is RLS's job, not a
// prop's. `gate_passes_select` (migration 046) already narrows an `hod`
// session to `department_id in (select gatepass.my_department_ids())` — the
// same view, the same query, a different session, a different result set.
// Adding a client-side `.eq('department_id', …)` on top would be redundant at
// best and a second, driftable copy of a rule the database already enforces
// at worst.
//
// The one real difference — the two columns/filters naming a department and a
// raiser that would, for an HOD, only ever answer one way — is the single
// `showPeople={false}` prop `ReportsPage` grew for exactly this screen.
import React from 'react';
import ReportsPage from '../Admin/ReportsPage';

export default function HodReports(): React.ReactElement {
  return <ReportsPage showPeople={false} />;
}
