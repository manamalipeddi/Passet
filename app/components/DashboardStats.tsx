'use client';
import { useEffect, useState } from 'react';
import type { HomeStats, Acc } from '@/lib/homeStats';

// The streak / last-session / accuracy / progress numbers. Server-rendered for
// first paint, then self-refreshing: it re-fetches /api/home-stats whenever the
// dashboard is shown (mount, tab focus, app resume). This is what guarantees the
// numbers reflect a session you just finished — no page reload or cache-busting
// needed, because it's an explicit no-store fetch each time.
const fmtAcc = (a: Acc) => (a.avg == null ? '—' : `${a.avg}%`);

export default function DashboardStats({ initial }: { initial: HomeStats }) {
  const [s, setS] = useState<HomeStats>(initial);

  useEffect(() => {
    let alive = true;
    const pull = () => {
      fetch('/api/home-stats', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (alive && data) setS(data as HomeStats); })
        .catch(() => {});
    };
    pull();
    const onVisible = () => { if (document.visibilityState === 'visible') pull(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', pull);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', pull);
    };
  }, []);

  return (
    <>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
        Last vocab: {s.lastVocab}<br />Last grammar: {s.lastGrammar}
      </p>

      <div className="row2" style={{ marginTop: 18 }}>
        <div className="stat">
          <div className="num">{s.streak === 0 ? '—' : `🔥 ${s.streak}`}</div>
          <div className="lbl">
            day streak<br />
            🏆 {s.longestStreak} best{s.atBest && s.streak > 1 ? ' · new record!' : ''}
          </div>
        </div>
        <div className="stat">
          <div className="num">{s.touched}<span style={{ fontSize: 16, color: 'var(--text-muted)' }}> / {s.totalWords}{s.startedPct !== null ? ` (${s.startedPct}%)` : ''}</span></div>
          <div className="lbl">words started<br />{s.known}{s.masteredPct !== null ? ` (${s.masteredPct}%)` : ''} mastered</div>
        </div>
      </div>

      <div className="row2" style={{ marginTop: 14 }}>
        <div className="stat">
          <div className="num" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.4 }}>
            <div>Vocab {fmtAcc(s.vocabAcc)}</div>
            <div>Grammar {fmtAcc(s.grammarAcc)}</div>
            <div>Listening {fmtAcc(s.listenAcc)}</div>
          </div>
          <div className="lbl">avg accuracy · last 3 sessions</div>
        </div>
        <div className="stat">
          <div className="num">{s.grammarStartedCount}<span style={{ fontSize: 16, color: 'var(--text-muted)' }}> / {s.grammarTotal}{s.grammarStartedPct !== null ? ` (${s.grammarStartedPct}%)` : ''}</span></div>
          <div className="lbl">grammar started<br />{s.grammarKnown}{s.grammarMasteredPct !== null ? ` (${s.grammarMasteredPct}%)` : ''} mastered</div>
        </div>
      </div>
    </>
  );
}
