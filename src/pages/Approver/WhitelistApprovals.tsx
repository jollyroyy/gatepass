// The CEO's whitelist queue (client, 2026-08-20: "when the CEO role is logged
// in, he should also be able to see all the whitelist requests with the reason
// and should be able to approve or reject").
//
// IT REUSES THE ADMIN'S OWN COMPONENT, `WhitelistRequestsTab`, rather than
// drawing a second one: an admin and the CEO must read the same request, the
// same justification and the same decision, and two components is two things
// to change when the wording moves. What differs is only the shell around it.
//
// WHO MAY ACT IS THE DATABASE'S ANSWER, NOT THIS ROUTE'S. `/whitelist` is open
// to any office holder (route access is UX defence in depth — see
// roleRoutes.ts), and the page shows a COO or a Security Head an empty list,
// because migration 053 narrows `list_whitelist_requests` to
// `is_admin() or is_ceo()` and the two decide RPCs have always demanded
// `is_ceo()`. The link that leads here is drawn for the CEO alone.
//
// The `.gb-board gb-main` island is the same skin `/approvals` uses, so an
// office holder never crosses between the guard's light screen and the house
// dark default mid-session.
import React, { useState } from 'react';
import GuardPageHeader from '../../components/guard/GuardPageHeader';
import WhitelistRequestsTab from '../Admin/WhitelistRequestsTab';

export default function WhitelistApprovals(): React.ReactElement {
  const [stamp] = useState(() => new Date().toISOString());

  return (
    <div className="gb-board gb-main">
      <GuardPageHeader
        title="Whitelist Requests"
        subtitle="Vendors an admin has asked to take off the blacklist. Only the CEO decides."
        glyph="alert"
        tone="purple"
        stamp={stamp}
      />
      <WhitelistRequestsTab />
    </div>
  );
}
