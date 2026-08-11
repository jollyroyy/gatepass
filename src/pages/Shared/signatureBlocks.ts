// The six signatures a printed gate pass carries, defined once.
//
// Row 1 is the approval chain, signed BEFORE the material moves:
//   Issuing HOD → Security HOD → COO → Finance HOD
// Row 2 is what happens AT the gate, signed as it moves:
//   Security Verification → Receiver Signature
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
    { label: 'Finance HOD', caption: 'Signature & Stamp' },
  ],
  [
    { label: 'Security Verification', caption: 'Signature & Stamp' },
    { label: 'Receiver Signature', caption: 'Signature & Stamp' },
  ],
];
