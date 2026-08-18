// The Gate Pass Details record a Search Pass query resolves to: the title with
// the pass's one live badge, Print Pass, the summary card, the item
// table, the return-activity rail, and the "still needs attention" footer.
//
// Composition only — the three panels own their own markup and the numbers all
// come from `src/lib/passRecordView.ts`, so a figure in the header can never
// disagree with the rows underneath it.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassRecord } from '../../lib/useGatePassRecord';
import { passStageStyle } from '../../lib/passStage';
import { OVERDUE_STYLE } from '../../lib/statusStyles';
import { pendingItemCount } from '../../lib/passRecordView';
import Badge, { TypeChip } from '../Badge';
import { returnDeskFor } from '../../lib/overdueItems';
import PassRecordSummary from './PassRecordSummary';
import PassRecordItems from './PassRecordItems';
import PassRecordActivity from './PassRecordActivity';

type Props = {
  record: GatePassRecord;
  onClear?: () => void;
};

export default function PassRecordView({ record, onClear }: Props): React.ReactElement {
  const { pass, items, activity } = record;
  const outstanding = pendingItemCount(items, pass.type);

  return (
    <section data-testid="pass-record" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="page-title !mb-0">Gate Pass Details</h1>
          <TypeChip type={pass.type} />
          <Badge style={passStageStyle(pass)} />
          {pass.is_overdue && <Badge style={OVERDUE_STYLE} />}
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/pass/${pass.id}/print`} className="btn-secondary inline-flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 8.25V3.75h10.5v4.5M6.75 17.25h10.5v3h-10.5v-3z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 17.25H4.5a1.5 1.5 0 01-1.5-1.5v-4.5a1.5 1.5 0 011.5-1.5h15a1.5 1.5 0 011.5 1.5v4.5a1.5 1.5 0 01-1.5 1.5h-2.25" />
            </svg>
            Print Pass
          </Link>
          {onClear && (
            <button type="button" className="btn-ghost" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
      </div>

      <PassRecordSummary pass={pass} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <div className="xl:col-span-2 flex flex-col gap-5">
          <PassRecordItems pass={pass} items={items} />

          {outstanding > 0 && (
            <div className="alert-warning justify-between flex-wrap gap-3">
              <span className="font-semibold">
                {outstanding} {outstanding === 1 ? 'item still needs' : 'items still need'} attention before this
                pass can be closed
              </span>
              <Link to={returnDeskFor(pass)} className="btn-primary shrink-0">
                Review pending items
              </Link>
            </div>
          )}
        </div>

        <PassRecordActivity entries={activity} />
      </div>
    </section>
  );
}
