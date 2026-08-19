// The one rupee formatter in the app — the HOD board's overdue value, the pass
// detail page, the compact pass card and My Passes all read from it, so a value
// can never be spelled two ways on two screens.
//
// IT DOES NOT ABBREVIATE, and that is the point (client's call, 2026-08-17:
// "you should not mention 3k, 4k — it should be the exact number, like 3100,
// 200, 110"). It used to print "₹3.1K" and "₹1.1L", which rounds away the very
// figure a gate pass is about: ₹3,149 and ₹3,050 both read "₹3.1K", and a guard
// comparing the slip against the screen has nothing to compare.
//
// Indian digit grouping stays — `en-IN` gives ₹1,10,000, which separates digits
// without losing any. Values are rounded to whole rupees; paise are not entered
// anywhere in this system.
//
// NULL-SAFE ON THE HELPER, NOT ON EVERY CALLER (045). `approx_value` has always
// been optional, and the raise form drops it from every new line as of the
// client's mock-up — so an unpriced item is now the common case, not the rare
// one. `Math.round(null)` is 0, and printing "₹0" on a slip or a pass record
// reads as "this is worth nothing", which is a different claim from "no value
// was declared". Every existing caller already guards this by hand (`> 0 ? … :
// '—'`, or an inline `!= null` check) before calling in; centralising the
// check here means a caller who forgets to guard gets the right answer anyway,
// and it costs the guarded callers nothing since they never pass null through.
export function formatCurrency(n: number | null | undefined): string {
  if (n == null) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
