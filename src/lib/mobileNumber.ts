// The mock's mobile field is a dial-code select welded to a number box, but the
// pass stores ONE string — `visitor_company`'s packed `v` — and every screen
// that shows a contact number (`pass_contact`, the record's Fact strip, the
// printed slip) reads that one string. So the two controls are joined here, on
// the way in, and split here, on the way back out for display.
//
// Storing the parts separately would mean a migration, a second column on the
// packed blob, and two more places for a number to disagree with itself.

export interface DialCode {
  code: string;
  label: string;
}

/** Dial codes the site actually raises passes against. India first — it is the
 *  default the mock draws — then the Gulf and the two anglophone codes that
 *  turn up on supplier paperwork here. */
export const DIAL_CODES: DialCode[] = [
  { code: '+91', label: '+91' },
  { code: '+971', label: '+971' },
  { code: '+966', label: '+966' },
  { code: '+968', label: '+968' },
  { code: '+974', label: '+974' },
  { code: '+44', label: '+44' },
  { code: '+1', label: '+1' },
];

export const DEFAULT_DIAL = '+91';

/** One stored number → the two controls that draw it.
 *
 *  Longest code first, so `+91` cannot claim a `+9714…` number out from under
 *  `+971`. A number stored without any recognised code — every row raised
 *  before this form existed — keeps its digits and falls back to the default
 *  code rather than being shown mangled. */
export function splitMobile(value: string): { dial: string; digits: string } {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return { dial: DEFAULT_DIAL, digits: '' };
  const byLength = [...DIAL_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const { code } of byLength) {
    if (trimmed.startsWith(code)) {
      return { dial: code, digits: trimmed.slice(code.length).replace(/\D/g, '') };
    }
  }
  return { dial: DEFAULT_DIAL, digits: trimmed.replace(/\D/g, '') };
}

/** The two controls → the one stored string.
 *
 *  Empty digits store an EMPTY STRING, never a bare `+91`: a dial code on its
 *  own is not a contact number, and `packVendor` treats blank as "not given" so
 *  the pass records no phone at all rather than a code nobody can ring. */
export function joinMobile(dial: string, digits: string): string {
  const clean = (digits ?? '').replace(/\D/g, '');
  if (!clean) return '';
  return `${dial || DEFAULT_DIAL} ${clean}`;
}
