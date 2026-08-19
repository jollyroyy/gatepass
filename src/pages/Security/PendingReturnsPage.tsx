// Pending RGP Return (Needs Verification) — the return queue as a page of its
// own (client mock-up, 2026-08-19), opened by the figure on the dashboard.
//
// WHAT IS ON IT, AND WHAT IS DELIBERATELY NOT. `needsReturnVerification` is an
// open return (`awaiting_return` or `partially_returned`) graded `due_today` or
// `overdue` by the database in `site_tz()`. Material due in October is a real
// obligation that no guard is watching the barrier for, and neither `/returns`
// nor `/overdue` would accept its return today, so a row for it would be a
// button that cannot be pressed. The whole backlog of any date is one click
// away on Overdue Items.
//
// There is no type tab strip and no Type filter: only an RGP comes back, so a
// control with one live option is a control that teaches nothing. The search is
// the same GLOBAL one the Pending OUT page carries — it is not a filter over
// these rows, and a pass number typed here reaches the whole register.
import React, { useMemo, useState } from 'react';
import GuardPageHeader from '../../components/guard/GuardPageHeader';
import GuardPager from '../../components/guard/GuardPager';
import GuardToolbar from '../../components/guard/GuardToolbar';
import PendingReturnTable from '../../components/guard/PendingReturnTable';
import { useGuardSearch } from '../../components/guard/useGuardSearch';
import { pendingReturnsOf } from '../../lib/guardBoard';
import { DEFAULT_ROWS_PER_PAGE } from '../../lib/pendingOutFilters';
import { pageOf } from '../../lib/scheduledReturns';
import { useGuardQueues } from '../../lib/useGuardQueues';

export default function PendingReturnsPage(): React.ReactElement {
  const { openReturns, loading, error } = useGuardQueues('returns');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(DEFAULT_ROWS_PER_PAGE);
  const [stamp] = useState(() => new Date().toISOString());

  const search = useGuardSearch('Search by Pass No., Party, Mobile No.…');

  const rows = useMemo(() => pendingReturnsOf(openReturns), [openReturns]);
  const current = pageOf(rows, page, size);

  return (
    <div className="gb-board">
      <GuardPageHeader
        title="Pending RGP Return (Needs Verification)"
        subtitle="Verify material coming back that is due today or already late."
        glyph="returned"
        tone="blue"
        stamp={stamp}
      />

      <GuardToolbar search={search.bar} />

      {search.notice}

      {search.results ?? (
        <>
          {error && <div className="gb-alert">{error}</div>}

          <section className="gb-card gb-panel">
            {loading ? (
              <div className="gb-empty">
                <div className="gb-skeleton" />
              </div>
            ) : current.total === 0 ? (
              <div className="gb-empty">Nothing is due back today, and nothing is late.</div>
            ) : (
              <>
                <div className="gb-scroll">
                  <PendingReturnTable rows={current.rows} />
                </div>
                <GuardPager
                  page={current}
                  size={size}
                  onPage={setPage}
                  onSize={(n) => {
                    setSize(n);
                    setPage(1);
                  }}
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
