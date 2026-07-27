// The physical A5 slip handed to the guard. Every colour here is a hardcoded
// black/white/gray literal (never the navy-* / surface-* tokens, which invert
// in dark mode) so the slip is legible on a cheap mono laser printer no
// matter which theme the app was in when it was printed.
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { PASS_TYPES } from '../../lib/passTypes';
import { formatDateTime, formatDateOnly } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import QrPass from '../../components/QrPass';

function Row({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <tr>
      <td className="border border-black px-3 py-1.5 font-semibold text-black w-1/3 align-top">{label}</td>
      <td className="border border-black px-3 py-1.5 text-black align-top">{value ?? '—'}</td>
    </tr>
  );
}

function SignatureBox({ label }: { label: string }): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <div className="border border-black h-16 w-full" />
      <p className="text-[11px] text-black font-medium text-center">{label}</p>
    </div>
  );
}

export default function PassPrint(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [pass, setPass] = useState<GatePassView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data, error: err } = await gp().from('v_gate_passes').select('*').eq('id', id).maybeSingle();
        if (err) throw err;
        if (!cancelled) setPass((data as GatePassView | null) ?? null);
      } catch (e) {
        if (!cancelled) setError(safeErrorMessage(e));
      }
    }
    if (id) load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (pass === undefined) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="skeleton h-96 w-full" />
      </div>
    );
  }

  if (pass === null) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="empty-state card p-10">
          <p className="text-navy-700 font-medium">Pass not found, or you don't have access to it.</p>
          {error && <p className="text-sm text-flagged-700 mt-2">{error}</p>}
          <Link to="/" className="btn-secondary inline-block mt-4">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const isRgp = pass.type === 'RGP';

  return (
    <div>
      <div className="no-print flex items-center justify-between gap-3 max-w-2xl mx-auto p-4">
        <Link to={`/pass/${pass.id}`} className="btn-secondary">
          Back
        </Link>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <div className="max-w-2xl mx-auto p-4 print:p-0 print:max-w-none">
        <div className="border-2 border-black bg-white text-black p-5">
          <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3 mb-3">
            <div>
              <h1 className="text-lg font-extrabold tracking-wide text-black">MATERIAL GATE PASS</h1>
              <p className="text-sm font-semibold text-black">{PASS_TYPES[pass.type].label}</p>
              <p className="text-2xl font-extrabold font-mono text-black mt-1">{pass.pass_number}</p>
            </div>
            {/* The QR carries qr_token; the human-readable number above it is
                what a guard types when the code is torn or smudged. */}
            <QrPass value={pass.qr_token} size={120} />
          </div>

          <table className="w-full border-collapse text-sm mb-4">
            <tbody>
              <Row label="Visitor" value={pass.visitor_name} />
              <Row label="Company" value={pass.visitor_company} />
              <Row label="Material" value={pass.material_summary ?? ''} />
              {/* Full word, not the arrow glyph from PASS_DIRECTIONS — this table
                  is mono black/white, so the arrow's meaning must not depend on
                  a reader recognising which way it points. */}
              <Row label="Direction" value={pass.direction === 'in' ? 'INWARD' : 'OUTWARD'} />
              <Row label="Quantity" value={`${pass.item_count} line(s)`} />
              <Row label="Vehicle No" value={pass.vehicle_number} />
              <Row label="Purpose" value={pass.purpose} />
              <Row label="Department" value={pass.department_name} />
              <Row label="Raised By" value={pass.raised_by_name} />
              <Row label="Raised On" value={formatDateTime(pass.created_at)} />
              {isRgp && <Row label="Expected Return" value={formatDateOnly(pass.expected_return_date)} />}
            </tbody>
          </table>

          <div className="flex gap-4 pt-2">
            <SignatureBox label="Issued By (HOD)" />
            <SignatureBox label="Carrier Signature" />
            <SignatureBox label="Security Verification" />
          </div>
        </div>
      </div>
    </div>
  );
}
