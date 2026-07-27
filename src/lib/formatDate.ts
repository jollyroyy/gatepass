import { differenceInDays, differenceInHours, differenceInMinutes } from 'date-fns';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export function formatDuration(checkedInAt: string | null | undefined): { text: string; isOvertime: boolean } {
  if (!checkedInAt) return { text: '—', isOvertime: false };
  const ms = Date.now() - new Date(checkedInAt).getTime();
  if (ms < 0) return { text: '0m', isOvertime: false };
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return { text: `${hours}h ${minutes}m`, isOvertime: hours >= 9 };
  return { text: `${minutes}m`, isOvertime: false };
}

/**
 * Compact queue-friendly age, e.g. `4m`, `2h`, `3d` — how long a pass has
 * waited. Always shows the largest whole unit; never negative.
 */
export function relativeAge(iso: string): string {
  const then = new Date(iso);
  const now = new Date();

  const days = differenceInDays(now, then);
  if (days >= 1) return `${days}d`;

  const hours = differenceInHours(now, then);
  if (hours >= 1) return `${hours}h`;

  const minutes = Math.max(differenceInMinutes(now, then), 0);
  return `${minutes}m`;
}

/** Date-only display, e.g. `26 Jul 2026`. */
export function formatDateOnly(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}
