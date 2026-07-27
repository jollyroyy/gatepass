// HOD analytics — same component as the admin tab, scoped by RLS to the HOD's
// own departments automatically when queried through v_gate_passes.
import React from 'react';
import AIAnalyticsTab from '../Admin/AIAnalyticsTab';

export default function HodAnalytics(): React.ReactElement {
  return <AIAnalyticsTab />;
}
