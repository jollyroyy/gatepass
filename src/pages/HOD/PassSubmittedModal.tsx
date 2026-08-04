// Success modal shown after RaisePass.tsx submits a new pass.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { PASS_TYPES } from '../../lib/passTypes';

interface PassSubmittedModalProps {
  submittedPass: GatePassView;
  deptName: string;
  itemCount: number;
}

export default function PassSubmittedModal({
  submittedPass,
  deptName,
  itemCount,
}: PassSubmittedModalProps): React.ReactElement {
  return (
    <div className="modal-overlay">
      <div className="modal-content p-6 max-w-md">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-matched-100 flex items-center justify-center">
            <svg className="h-6 w-6 text-matched-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-navy-900">Pass Submitted</h3>
            <p className="text-sm text-navy-500">
              <span className="font-semibold text-navy-700">{submittedPass.pass_number}</span>
              {' · '}{PASS_TYPES[submittedPass.type]?.label ?? submittedPass.type}
            </p>
          </div>
        </div>

        <div className="bg-surface-50 rounded-lg p-4 mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-navy-400">Department</span>
            <span className="font-medium text-navy-700">{deptName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-navy-400">Items</span>
            <span className="font-medium text-navy-700">{itemCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-navy-400">Visitor</span>
            <span className="font-medium text-navy-700">{submittedPass.visitor_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-navy-400">Status</span>
            <span className="font-medium text-pending-600">Pending Gate Review</span>
          </div>
        </div>

        <p className="text-xs text-navy-400 mb-4">
          Security has been notified. The pass will appear in the gate console
          for verification when the material arrives at the gate.
        </p>

        <div className="flex gap-3">
          <Link to={`/pass/${submittedPass.id}`} className="btn-primary flex-1 text-center">
            View Pass
          </Link>
          <Link to="/dashboard" className="btn-secondary flex-1 text-center">
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
