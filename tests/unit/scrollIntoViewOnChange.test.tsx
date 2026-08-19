// `useScrollIntoViewOnChange` — the hook that brings a revealed list into view
// when a board's selected figure changes, and never on first mount.
//
// It used to be exercised through the guard's dashboard as well; that board has
// no drills any more (2026-08-19), so the hook's remaining consumer is
// `GateBoard` — the admin's and the HOD's shared board — and this file tests it
// directly, which is where it was always cheapest and least brittle.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScrollIntoViewOnChange } from '../../src/lib/useScrollIntoViewOnChange';

describe('useScrollIntoViewOnChange', () => {
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;
  let matchMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
    matchMediaMock = vi.fn().mockReturnValue({ matches: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).matchMedia = matchMediaMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not scroll on initial render', () => {
    const { result } = renderHook(({ key }) => useScrollIntoViewOnChange<HTMLDivElement>(key), {
      initialProps: { key: 'pending' },
    });
    const div = document.createElement('div');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result.current as any).current = div;
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('scrolls when the key changes', () => {
    const div = document.createElement('div');
    const { result, rerender } = renderHook(({ key }) => useScrollIntoViewOnChange<HTMLDivElement>(key), {
      initialProps: { key: 'pending' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result.current as any).current = div;

    rerender({ key: 'flagged' });

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('uses behavior "auto" when prefers-reduced-motion matches', () => {
    matchMediaMock.mockReturnValue({ matches: true });
    const div = document.createElement('div');
    const { result, rerender } = renderHook(({ key }) => useScrollIntoViewOnChange<HTMLDivElement>(key), {
      initialProps: { key: 'pending' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result.current as any).current = div;

    rerender({ key: 'flagged' });

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('does nothing when key changes but ref has no element attached', () => {
    const { rerender } = renderHook(({ key }) => useScrollIntoViewOnChange<HTMLDivElement>(key), {
      initialProps: { key: 'pending' },
    });
    rerender({ key: 'flagged' });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});
