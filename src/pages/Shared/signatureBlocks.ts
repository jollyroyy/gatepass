// The seven signatures a printed gate pass carries, defined once.
//
// Rows 1–2 are the approval chain, signed BEFORE the material moves. Read
// left→right, top→bottom it is:
//   Issuing HOD → Security HOD → COO → CEO → Finance HOD
// Row 3 is what happens AT the gate, signed as it moves:
//   Security Verification → Receiver Signature
//
// The split after COO is a PRINT constraint, not a grouping. The slip is A5;
// five boxes on one line leaves ~18mm each, which is narrower than a rubber
// stamp. Three per row keeps every box the same third-of-a-sheet width on all
// three rows. Keep rows at three or fewer — PassPrint pads short rows out to
// three so the boxes never stretch to fill the sheet.
//
// The same six appear on every category — RGP Out, RGP In and NRGP Out. The
// approval chain is a matter of who authorises material movement; it does not
// change with the direction the material happens to be travelling. Making the
// blocks conditional would produce slips that differ page to page, and a guard
// comparing two of them could not tell a missing signature from a slip that
// never had that box.
export interface SignatureBlock {
  label: string;
  /** Printed small under the rule — tells the signer to stamp as well as sign. */
  caption: string;
}

export const SIGNATURE_ROWS: SignatureBlock[][] = [
  [
    { label: 'Issuing HOD', caption: 'Signature & Stamp' },
    { label: 'Security HOD', caption: 'Signature & Stamp' },
    { label: 'COO', caption: 'Signature & Stamp' },
  ],
  [
    { label: 'CEO', caption: 'Signature & Stamp' },
    { label: 'Finance HOD', caption: 'Signature & Stamp' },
  ],
  [
    { label: 'Security Verification', caption: 'Signature & Stamp' },
    { label: 'Receiver Signature', caption: 'Signature & Stamp' },
  ],
];
