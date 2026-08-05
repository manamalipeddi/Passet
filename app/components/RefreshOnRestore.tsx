'use client';
import { useEffect } from 'react';

// The dashboard is force-dynamic, but the browser keeps the rendered page around
// after you navigate away: Chrome's back/forward cache restores it on a back
// gesture, and an installed PWA keeps it alive in the background. Either way the
// streak and progress stats can appear frozen after a practice session. Reload
// to pull fresh numbers when the page is revived from that cache, or brought
// back to the foreground after being hidden long enough to be a new visit.
// Scoped to the dashboard so it never interrupts a live lesson.
export default function RefreshOnRestore() {
  useEffect(() => {
    // Revived from the back/forward cache (back-gesture navigation).
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    // Reopened after the PWA/tab was backgrounded. Only reload if it was hidden
    // long enough to plausibly be a new session, so quick app switches don't
    // trigger a jarring refresh.
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 10_000) {
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return null;
}
