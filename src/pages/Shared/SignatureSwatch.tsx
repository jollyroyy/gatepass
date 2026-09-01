// The white plate a signature is shown on — a FIXED-CONTEXT SURFACE, and its
// own file for that reason.
//
// A signature PNG is ink with no background of its own. It has to sit on white
// wherever it is drawn, because that is what it will be printed on and because
// black strokes on the shipped dark shell are invisible. So this plate is
// literal `bg-white` with literal ink, and it must never pick up a `navy-*` or
// `surface-*` token: that ramp INVERTS under `.dark` (the default), which is
// how a light-on-light panel gets shipped — see CLAUDE.md's "Fixed-context
// surfaces" rule, and `QuestLockup tone="light"` for the same treatment.
//
// WHY IT IS SPLIT OUT rather than written inline in `SignatureCard`. The theme
// audit (`tests/unit/themeAudit.test.ts`) fails any .tsx that contains BOTH an
// opaque `bg-white` and a `text-navy-*`, because it cannot tell which text sits
// on which surface — and the card legitimately wants navy captions on its own
// theme-following card face, around this plate. Splitting the plate off makes
// the audit's rule TRUE of both files instead of exempting one of them, which
// is the difference between a rule and a list.
import React from 'react';

export default function SignatureSwatch(
  { src, alt = 'Your signature' }: { src: string; alt?: string },
): React.ReactElement {
  return (
    <div className="rounded-lg border border-black/15 bg-white p-3">
      <img src={src} alt={alt} className="max-h-20 w-auto object-contain" />
    </div>
  );
}
