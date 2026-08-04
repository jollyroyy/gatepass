// Shared toolbar for the Reports page: date picker + range presets on the
// left, print on the right. CSV export lives on each report view instead —
// only a view knows its filtered rows and columns, so exporting from here
// would duplicate that knowledge in the parent.
import React from 'react';
import { RANGE_PRESETS, type RangePreset } from '../../lib/reportsDateRange';

type Props = {
  date: string;
  today: string;
  onDateChange: (date: string) => void;
  preset: RangePreset;
  onPresetChange: (preset: RangePreset) => void;
  onPrint: () => void;
};

export default function ReportsToolbar({
  date,
  today,
  onDateChange,
  preset,
  onPresetChange,
  onPrint,
}: Props): React.ReactElement {
  return (
    <div className="card p-4 flex items-center gap-4 flex-wrap no-print">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-navy-600">Date:</label>
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          max={today}
          className="input w-auto"
        />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Report range">
        {RANGE_PRESETS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onPresetChange(key)}
            className={key === preset ? 'tab-active text-xs px-3 py-1.5' : 'tab-inactive text-xs px-3 py-1.5'}
          >
            {label}
          </button>
        ))}
      </div>

      <button type="button" className="btn-secondary text-sm ml-auto" onClick={onPrint}>
        Print Report
      </button>
    </div>
  );
}
