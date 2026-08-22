// THE SIGNATURE BOXES, DRAWN. The derivation and the argument for it are in
// `src/lib/printSignatureBoxes.ts`; this file is the ink.
//
// Three to a row, which is a PRINT constraint and not a grouping: the slip is
// A5, and five boxes on one line leaves each of them narrower than a rubber
// stamp. A CSS grid of three keeps every box the same third-of-a-sheet width
// whether the last row holds one box or three.
//
// NO COLOUR CARRIES ANYTHING. A tick is a tick and a cross is a cross, and the
// caption under the rule says the same thing in words — this sheet is read on a
// cheap mono laser, and half the people reading it are standing at a barrier.
import React from 'react';
import type { SignatureBoxView } from '../../lib/printSignatureBoxes';
import { formatDateTime } from '../../lib/formatDate';

/** The mark inside the box. An empty square for a box nobody has signed —
 *  drawn, not omitted, because an absent square reads as a printing fault where
 *  an empty one reads as "nothing yet". */
function Mark({ state }: { state: SignatureBoxView['state'] }): React.ReactElement | null {
  if (state === 'blank') return null;
  const glyph = state === 'signed' ? '✓' : state === 'rejected' ? '✗' : state === 'not_required' ? '—' : '';
  return (
    <span
      className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center border border-black text-[11px] font-extrabold leading-none text-black"
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}

function Box({ box }: { box: SignatureBoxView }): React.ReactElement {
  return (
    <div className="border border-black p-2 print:break-inside-avoid">
      <div className="flex items-center gap-1.5">
        <Mark state={box.state} />
        <span className="text-[10px] font-extrabold uppercase tracking-wide text-black">
          {box.label}
        </span>
      </div>

      {/* The signing space. A box that has been signed digitally does not need
          the rule, so the name and the moment take its place; a box that has
          not keeps the empty height, so the sheet does not reflow as approvals
          come in and two printouts of the same pass stay comparable. */}
      <div className="mt-1 h-[34px] text-[9px] leading-tight text-black">
        {box.signer && <span className="block font-semibold">{box.signer}</span>}
        {box.at && <span className="block">{formatDateTime(box.at)}</span>}
      </div>

      <div className="border-t border-black pt-0.5 text-[8px] uppercase tracking-wide text-black">
        {box.caption}
      </div>
    </div>
  );
}

export default function PrintSignatureBoxes(
  { boxes }: { boxes: SignatureBoxView[] },
): React.ReactElement {
  return (
    <div className="pt-2">
      <p className="text-[11px] font-bold text-black uppercase tracking-wider mb-1">
        Approvals
      </p>
      {/* Load-bearing sentence: a tick in a box is an approval given in the
          portal, not a mark somebody made with a pen, and a reader who does not
          know that cannot tell the two apart on paper. */}
      <p className="text-[9px] text-black mb-2 leading-tight">
        A ticked box is an approval recorded in Quest GatePass by the office named, at the date
        and time shown. Only the receiver's box is signed by hand.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {boxes.map((box) => (
          <Box key={box.key} box={box} />
        ))}
      </div>
    </div>
  );
}
