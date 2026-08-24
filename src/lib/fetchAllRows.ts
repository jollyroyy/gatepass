// Read every row a query matches, not the first page of them.
//
// PostgREST caps a response at `max-rows` (1000 on this project) and SAYS
// NOTHING ABOUT IT — no error, no header the client library surfaces, just a
// shorter array. A screen that counts what it got then reports a number that is
// quietly wrong, and on the approvals queue that meant a gate pass routed to an
// office never appeared in that office's list at all: 1124 rows readable, 1000
// returned, the newest one missing, and "Nothing is waiting on your signature"
// printed over 231 pending requests (2026-08-24).
//
// A FULL PAGE IS NOT EVIDENCE THE DATA ENDED. The only way to know a capped
// endpoint has run out is to ask for the next window and get back less than a
// full one, which is what this does.
//
// Use it wherever a total has to be right — the boards' whole invariant is that
// a KPI's figure is `rows.length` of the list it opens, and a truncated read
// breaks that silently. Do NOT reach for it to render a long table: that wants
// paging in the UI, not every row in memory.

/** The server's own page size. Asking for more than this gets this anyway. */
export const PAGE_ROWS = 1000;

/** A runaway guard: 100 pages is 100,000 rows, far past anything this app shows. */
const MAX_PAGES = 100;

/**
 * @param query  called with an inclusive `[from, to]` row window — pass it
 *               straight to PostgREST's `.range(from, to)`.
 */
export async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_ROWS;
    const { data, error } = await query(from, from + PAGE_ROWS - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    // Short page — including an empty one — means there is no more.
    if (rows.length < PAGE_ROWS) return all;
  }
  throw new Error(
    `fetchAllRows: too many pages (over ${MAX_PAGES * PAGE_ROWS} rows). `
    + 'Narrow the query rather than reading the whole table.',
  );
}
