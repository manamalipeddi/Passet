// Human-friendly "when was the last session" formatting.
//
// Personal, Sweden-based single-user app: format everything in the user's local
// timezone (Europe/Stockholm) regardless of where the server runs (Vercel runs
// in UTC), so "today"/"yesterday" boundaries and the shown clock time are right.
const TZ = 'Europe/Stockholm';

// YYYY-MM-DD for a given instant, as seen in Stockholm. en-CA gives ISO order.
function ymdInTz(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

// HH:MM (24h) for a given instant, as seen in Stockholm.
function hmInTz(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
}

/**
 * Turn a timestamp into a relative label:
 *   "today at 14:30", "yesterday", "3 days ago", "4 weeks ago", "2 months ago".
 * Returns "No sessions yet" for missing/invalid input.
 */
export function formatLastSession(iso: string | null | undefined): string {
  if (!iso) return 'No sessions yet';
  const then = new Date(iso);
  if (isNaN(then.getTime())) return 'No sessions yet';

  // Whole-day difference by calendar date in Stockholm (not by elapsed hours),
  // so a session at 23:00 last night reads "yesterday", not "today".
  const dayDiff = Math.round(
    (Date.parse(ymdInTz(new Date())) - Date.parse(ymdInTz(then))) / 86400000,
  );

  if (dayDiff <= 0) return `today at ${hmInTz(then)}`;
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff < 7) return `${dayDiff} days ago`;
  if (dayDiff < 30) {
    const weeks = Math.floor(dayDiff / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  }
  if (dayDiff < 365) {
    const months = Math.floor(dayDiff / 30);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }
  const years = Math.floor(dayDiff / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
