// Shared compact currency formatter — used by the HOD dashboard's overdue
// delta and its Returnable Aging table so the two never format the same
// rupee value two different ways.
export function formatCurrency(n: number): string {
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
