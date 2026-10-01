'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// The dashboard is force-dynamic, but the browser keeps the rendered page around
// after you navigate away: the client router may serve a cached copy, Chrome's
// back/forward cache restores it on a back gesture, and an installed PWA keeps
// it alive in the background. Any of these can leave the streak, last-session
// and accuracy numbers frozen after a practice session.
//
// So we pull fresh data whenever the dashboard appears:
//   • on mount — router.refresh() re-runs the server component with fresh DB
//     reads (fixes a stale client-router copy on return from a session),
//   • on back/forward-cache restore — a hard reload for certainty,
//   • on returning to the foreground — soft refresh, or hard reload if it was
//     backgrounded long enough to plausibly be a new visit.
// Scoped to the dashboard so it never interrupts a live lesson.
export default function RefreshOnRestore() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();

    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (document.visibilityState === 'visible') {
        if (hiddenAt && Date.now() - hiddenAt > 10_000) window.location.reload();
        else router.refresh();
      }
    };
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [router]);
  return null;
}
