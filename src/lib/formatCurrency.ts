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
export function formatCurrency(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
