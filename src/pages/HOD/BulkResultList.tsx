// Success screen shown after BulkRaise.tsx creates a batch of passes.
import React from 'react';
import { Link } from 'react-router-dom';

interface BulkResult {
  pass_id: string;
  pass_number: string;
}

interface BulkResultListProps {
  results: BulkResult[];
  onCreateAnother: () => void;
}

export default function BulkResultList({ results, onCreateAnother }: BulkResultListProps): React.ReactElement {
  return (
    <div className="card p-6">
      <div className="alert-success mb-4">{results.length} passes created successfully.</div>
      <div className="flex flex-col gap-2 mb-6 max-h-96 overflow-y-auto">
        {results.map((r) => (
          <Link key={r.pass_id} to={`/pass/${r.pass_id}`} className="list-item text-sm font-mono">
            {r.pass_number}
          </Link>
        ))}
      </div>
      <div className="flex gap-3">
        <button type="button" className="btn-primary" onClick={onCreateAnother}>Create Another Batch</button>
        <Link to="/my-passes" className="btn-secondary">View All in My Passes</Link>
      </div>
    </div>
  );
}
