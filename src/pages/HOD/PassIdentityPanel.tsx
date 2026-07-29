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
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-3 bg-navy-950 rounded-xl text-sm">
      <div className="flex items-center gap-2">
        <span className="text-navy-400 text-xs font-medium uppercase tracking-wider">Serial</span>
        <span className="font-mono font-bold text-white tracking-tight">{passNumberPrefix}-####</span>
      </div>
      <div className="w-px h-5 bg-navy-700 hidden sm:block" />
      <div className="flex items-center gap-2">
        <span className="text-navy-400 text-xs font-medium uppercase tracking-wider">Date</span>
        <span className="font-medium text-white">{todayDisplay()}</span>
      </div>
      <div className="w-px h-5 bg-navy-700 hidden sm:block" />
      <div className="flex items-center gap-2">
        <span className="text-navy-400 text-xs font-medium uppercase tracking-wider">Raised By</span>
        <span className="font-medium text-white">{hodName ?? '—'}</span>
      </div>
    </div>
  );
}
