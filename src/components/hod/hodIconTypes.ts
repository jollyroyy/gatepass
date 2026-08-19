// The HOD dashboard's icon vocabulary, as types alone.
//
// Split out of `HodIcon.tsx` so `src/lib/hodBoard.ts` and `src/lib/hodApprovals.ts`
// can name a glyph and a tone without a lib module importing a component.
//
// `HodTone` is its OWN union, not the house `Tone` ramp and not the guard
// board's `GuardTone`. All three are drawn from different palettes — the house
// ramp is Quest brass gold on warm stone, the guard's is the gate mock-up's,
// this is the HOD mock-up's — and keeping them separate is what stops one
// leaking into another by accident.
export type HodTone = 'blue' | 'green' | 'purple' | 'orange' | 'red';

export type HodGlyph =
  | 'document'   // Total Passes — a sheet of paper.
  | 'send'       // NRGP Issued — a paper plane; material leaving for good.
  | 'exchange'   // RGP Issued — two arrows in a circle; it comes back.
  | 'clock'      // Pending Return — a date the reader is being held to.
  | 'documentAdd'// Raise NRGP.
  | 'exchangeAdd'// Raise RGP.
  | 'hourglass'  // The Approval Pending strip's own heading.
  | 'people'     // An office staffed by people — HOD, Other Approvers.
  | 'shield'     // Security.
  | 'wallet';    // Finance.
