// HOD Dashboard — the same board the admin gets, narrowed to one person.
//
// Rebuilt 2026-08-17 to the client's reference layout. The layout itself lives in
// `src/components/board/GateBoard.tsx`; this file is the HOD's data, the HOD's two
// extra panels, and nothing else.
//
// TWO SCOPES STACK HERE, AND ONLY ONE OF THEM IS THIS PAGE'S DOING:
//
//   Department — RLS. `gate_passes_select` (002) shows an HOD only
//                `department_id in (select my_department_ids())`, and since `032`
//                a person holds at most one department. Nothing here asks for
//                that; it is the shape of the data that arrives.
//   Person     — `.eq('raised_by', userId)`, applied in useHodBoardData.ts, on
//                every read. A department may host more than one HOD and the
//                client asked for this board to be the reader's own. SERVER-side
//                on purpose: filtering client-side would download a colleague's
//                passes in order to hide them.
//
// TWO DIFFERENCES FROM THE ADMIN BOARD, both consequences of "one person, one
// department":
//   * a drill row does not print the raiser's name — the reader raised every
//     pass on this board, so their own name back at them is noise;
//   * links go to `/my-passes`, since `ROLE_ROUTES` closes `/all-passes` to an HOD.
import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { isExpiredPending } from '../../lib/statusStyles';
import GateBoard from '../../components/board/GateBoard';
import FlaggedReviewCard from './FlaggedReviewCard';
import { useHodBoardData, useMyDepartmentNames } from './useHodBoardData';

/** Where this board sends a reader for anything older or wider than the panel in
 *  front of them. NOT `/all-passes` — `ROLE_ROUTES` closes that to an HOD. */
const REGISTER = '/my-passes';

export default function Dashboard(): React.ReactElement {
  const navigate = useNavigate();
  const { rows, flagged, loading, error, reload } = useHodBoardData();
  const deptNames = useMyDepartmentNames();

  // All-time, not period-scoped: an expired pass is dead paperwork whenever it
  // was raised, and the Today default must not hide it.
  const expired = rows.filter(isExpiredPending);

  return (
    <GateBoard
      title="Today's Gate Pass Summary"
      subtitle={
        deptNames.length > 0 ? `${deptNames.join(' · ')} — passes you raised` : 'Passes you raised'
      }
      rows={rows}
      loading={loading}
      error={error}
      registerTo={REGISTER}
      showRaisedBy={false}
      onRefresh={() => void reload()}
      banner={
        <>
          {/* Zero renders nothing — an empty red banner is noise. Expired is the
              one bucket that means material this HOD authorised never moved and
              the paperwork is now dead, so it gets a banner of its own rather
              than a tile among fourteen. */}
          {expired.length > 0 && (
            <div className="bg-flagged-500/10 border-l-4 border-flagged-500 rounded-r-lg px-4 py-3 mb-6">
              <p className="text-sm font-semibold text-flagged-700">
                {expired.length} {expired.length === 1 ? 'pass' : 'passes'} expired without reaching the gate.
              </p>
            </div>
          )}
          <p className="text-[11px] text-navy-500 mb-3">
            Older passes are in{' '}
            <Link to={REGISTER} className="text-accent-600 hover:underline font-semibold">
              My Passes
            </Link>
            .
          </p>
        </>
      }
      footer={
        /* Fed by the UNSCOPED flagged fetch, never a window — a mismatch raised
           yesterday still needs this HOD's decision today, and the period filter
           must not hide an open action item. Below the panels because it is a task
           list, not a measurement. */
        !loading ? (
          <div className="mt-8">
            <FlaggedReviewCard rows={flagged} onOpen={(id) => navigate(`/pass/${id}`)} />
          </div>
        ) : null
      }
    />
  );
}
