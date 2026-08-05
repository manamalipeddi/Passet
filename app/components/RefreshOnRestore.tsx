'use client';
import { useEffect } from 'react';

// The dashboard is force-dynamic, but iOS standalone PWAs (and Safari in
// general) restore pages from the back/forward cache without re-running the
// server render — so after a practice session the streak and progress stats
// can appear frozen when you swipe back or the OS resumes the app. A `pageshow`
// with `persisted` set means we were revived from that cache: reload to pull
// fresh numbers. Scoped to the dashboard so it never interrupts a live lesson.
export default function RefreshOnRestore() {
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  return null;
}
