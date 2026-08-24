// A GATE PASS THAT NEVER APPEARS IN AN OFFICE'S QUEUE IS NEVER SIGNED.
//
// `usePendingApprovals` read `pass_approvals` with `select('*')` — no filter, no
// range — and narrowed the result in TypeScript (`passIdsOnMyLadder`). PostgREST
// answers at most `max-rows` (1000 on this project) and says nothing about it:
// no error, no flag, just a shorter array. So once the four offices between them
// had written more than a thousand approval rows, the newest ones fell off the
// end of the page and the passes they belonged to were invisible to the very
// office they were routed to. Measured against the live project on 2026-08-24:
// 1124 rows readable, 1000 returned, and the most recently routed row was NOT
// among them — the queue read "Nothing is waiting on your signature" while 231
// requests sat pending.
//
// Two things were wrong and both are fixed:
//   1. the filter was applied in the client, so rows belonging to other offices
//      consumed the page budget;
//   2. nothing paged, so the cap silently truncated the answer.
//
// `fetchAllRows` is the second half. It keeps asking for the next window until a
// window comes back short, which is the only way to know a capped endpoint has
// run out.
import { describe, it, expect, vi } from 'vitest';
import { fetchAllRows, PAGE_ROWS } from '../../src/lib/fetchAllRows';

const rows = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i }));

describe('fetchAllRows', () => {
  it('returns a single short page as it stands, asking only once', async () => {
    const q = vi.fn(async () => ({ data: rows(12), error: null }));
    expect(await fetchAllRows(q)).toHaveLength(12);
    expect(q).toHaveBeenCalledTimes(1);
    expect(q).toHaveBeenCalledWith(0, PAGE_ROWS - 1);
  });

  // The regression itself: a full page is not evidence that the data ended.
  it('keeps going past a FULL page and returns every row', async () => {
    const q = vi.fn(async (from: number) => ({
      data: from === 0 ? rows(PAGE_ROWS) : rows(124, PAGE_ROWS),
      error: null,
    }));
    const all = await fetchAllRows(q);
    expect(all).toHaveLength(PAGE_ROWS + 124);
    expect(q).toHaveBeenCalledTimes(2);
    expect(q).toHaveBeenNthCalledWith(2, PAGE_ROWS, PAGE_ROWS * 2 - 1);
  });

  // Exactly one page and then nothing: the second window comes back empty, which
  // is the end, not an error.
  it('stops on an empty follow-up page', async () => {
    const q = vi.fn(async (from: number) => ({
      data: from === 0 ? rows(PAGE_ROWS) : [],
      error: null,
    }));
    expect(await fetchAllRows(q)).toHaveLength(PAGE_ROWS);
    expect(q).toHaveBeenCalledTimes(2);
  });

  it('throws the error rather than returning a truncated answer', async () => {
    const q = vi.fn(async () => ({ data: null, error: { message: 'permission denied' } }));
    await expect(fetchAllRows(q)).rejects.toMatchObject({ message: 'permission denied' });
  });

  // A runaway server that always answers a full page must not loop for ever.
  it('gives up rather than paging without end', async () => {
    const q = vi.fn(async () => ({ data: rows(PAGE_ROWS), error: null }));
    await expect(fetchAllRows(q)).rejects.toThrow(/too many pages/i);
  });

  it('treats a null data page as the end', async () => {
    const q = vi.fn(async () => ({ data: null, error: null }));
    expect(await fetchAllRows(q)).toEqual([]);
  });
});
