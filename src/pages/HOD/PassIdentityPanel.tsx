import React from 'react';

interface PassIdentityPanelProps {
  passNumberPrefix: string;
  hodName: string | null;
}

function todayDisplay(): string {
  return new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function PassIdentityPanel({
  passNumberPrefix,
  hodName,
}: PassIdentityPanelProps): React.ReactElement {
  // Fixed-dark banner, deliberately NOT using navy-950/navy-500/navy-700
  // tokens: they invert under `.dark` (navy-950 is near-white there), which
  // paired with the hardcoded `text-white` below would go invisible —
  // white-on-white — the instant the app's default dark theme applies. This
  // strip is chrome, like `.shell-sidebar`, so it uses the same literal
  // hex/rgba approach rather than the theme-following ramp.
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-3 rounded-xl text-sm" style={{ background: '#16161A' }}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#9C978F' }}>Serial</span>
        <span className="font-mono font-bold text-white tracking-tight">{passNumberPrefix}-####</span>
      </div>
      <div className="w-px h-5 hidden sm:block" style={{ background: 'rgba(255,255,255,0.12)' }} />
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#9C978F' }}>Date</span>
        <span className="font-medium text-white">{todayDisplay()}</span>
      </div>
      <div className="w-px h-5 hidden sm:block" style={{ background: 'rgba(255,255,255,0.12)' }} />
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#9C978F' }}>Raised By</span>
        <span className="font-medium text-white">{hodName ?? '—'}</span>
      </div>
    </div>
  );
}
