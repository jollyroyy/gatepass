// Letterhead shown only on printed reports (see `.report-print-*` and the
// `@page report-sheet` rules in src/index.css). Quest logo top-left, title and
// range beside it, generated-on timestamp + entry count right-aligned
// opposite — separated from the table by a hairline rule. `.print-only`
// hides it on screen, so no colour-dependent info lives here.
import React from 'react';
import { QuestLockup } from './QuestMark';

type Props = {
  title: string;
  rangeLabel: string;
  entryCount: number;
};

export default function ReportsPrintHeader({ title, rangeLabel, entryCount }: Props): React.ReactElement {
  const generatedAt = new Date();

  return (
    <div className="report-print-header">
      <div className="report-print-header-left">
        <QuestLockup tone="light" size="sm" subtitle="Gate Pass" />
        <div className="report-print-header-text">
          <h1 className="report-print-title">{title}</h1>
          <p className="report-print-subtitle">{rangeLabel}</p>
        </div>
      </div>
      <div className="report-print-header-right">
        <p className="report-print-meta">
          Generated {generatedAt.toLocaleDateString('en-IN')} {generatedAt.toLocaleTimeString('en-IN')}
        </p>
        <p className="report-print-meta">
          {entryCount} {entryCount === 1 ? 'pass' : 'passes'}
        </p>
      </div>
    </div>
  );
}
