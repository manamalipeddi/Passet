import { getServiceClient } from '@/lib/supabase';
import { formatLastSession } from '@/lib/relativeTime';

// The dashboard's volatile numbers — the bits that change after every session.
// Computed in one place so the server render and the client live-refresh
// (/api/home-stats, polled when the dashboard is shown) can never disagree.

const SESSION_GAP_MS = 30 * 60 * 1000;

export type Acc = { avg: number | null; today: number | null };
export type HomeStats = {
  lastVocab: string;
  lastGrammar: string;
  streak: number;
  longestStreak: number;
  atBest: boolean;
  touched: number;
  totalWords: number;
  startedPct: number | null;
  known: number;
  masteredPct: number | null;
  grammarStartedCount: number;
  grammarTotal: number;
  grammarStartedPct: number | null;
  grammarKnown: number;
  grammarMasteredPct: number | null;
  vocabAcc: Acc;
  grammarAcc: Acc;
  listenAcc: Acc;
};

export async function computeHomeStats(
  supabase: ReturnType<typeof getServiceClient>,
): Promise<HomeStats> {
  const [
    { data: state },
    { count: learning },
    { count: known },
    { count: totalWords },
    { count: grammarTotal },
    { count: grammarKnown },
    { data: recent },
    { data: startedGpRows },
  ] = await Promise.all([
    supabase.from('streak_state').select('*').eq('id', 1).single(),
    supabase.from('user_progress').select('*', { count: 'exact', head: true }).eq('status', 'learning'),
    supabase.from('user_progress').select('*', { count: 'exact', head: true }).eq('status', 'known'),
    supabase.from('words').select('*', { count: 'exact', head: true }),
    supabase.from('grammar_points').select('*', { count: 'exact', head: true }),
    supabase.from('user_grammar_progress').select('*', { count: 'exact', head: true }).eq('status', 'known'),
    supabase.from('attempts').select('created_at, is_correct, grammar_point_ids, direction').order('created_at', { ascending: false }).limit(150),
    supabase.from('user_grammar_progress').select('grammar_point_id'),
  ]);

  const touched = (learning ?? 0) + (known ?? 0);
  const startedPct = totalWords ? Math.round((touched / totalWords) * 100) : null;
  const masteredPct = touched ? Math.round(((known ?? 0) / touched) * 100) : null;

  const grammarStartedCount = (startedGpRows ?? []).length;
  const grammarStartedPct = grammarTotal ? Math.round((grammarStartedCount / grammarTotal) * 100) : null;
  const grammarMasteredPct = grammarStartedCount ? Math.round(((grammarKnown ?? 0) / grammarStartedCount) * 100) : null;

  const streak = state?.current_streak ?? 0;
  const longestStreak = state?.longest_streak ?? streak;
  const atBest = streak > 0 && streak >= longestStreak;

  // Accuracy — average of the last 3 sessions per track. Three tracks: listening
  // attempts are tagged direction='listen'; of the rest, grammar attempts carry
  // grammar_point_ids and vocab attempts don't.
  const todayStr = new Date().toISOString().slice(0, 10);
  const classify = (a: any): 'vocab' | 'grammar' | 'listen' =>
    a.direction === 'listen' ? 'listen' : ((a.grammar_point_ids?.length ?? 0) > 0 ? 'grammar' : 'vocab');
  const sessionStats = (kind: 'vocab' | 'grammar' | 'listen'): Acc => {
    const track = (recent ?? []).filter((a: any) => classify(a) === kind);
    const sessions: { correct: number; total: number; t: number }[] = [];
    let prevT: number | null = null;
    for (const a of track) {
      const t = new Date(a.created_at).getTime();
      if (prevT === null || prevT - t > SESSION_GAP_MS) sessions.push({ correct: 0, total: 0, t });
      const cur = sessions[sessions.length - 1];
      cur.total++;
      if (a.is_correct) cur.correct++;
      prevT = t;
    }
    const last3 = sessions.slice(0, 3);
    const avg = last3.length
      ? Math.round((last3.reduce((s, x) => s + x.correct / x.total, 0) / last3.length) * 100)
      : null;
    const latest = sessions[0];
    const today = latest && new Date(latest.t).toISOString().slice(0, 10) === todayStr
      ? Math.round((latest.correct / latest.total) * 100)
      : null;
    return { avg, today };
  };

  return {
    lastVocab: formatLastSession(state?.last_vocab_at),
    lastGrammar: formatLastSession(state?.last_grammar_at),
    streak,
    longestStreak,
    atBest,
    touched,
    totalWords: totalWords ?? 0,
    startedPct,
    known: known ?? 0,
    masteredPct,
    grammarStartedCount,
    grammarTotal: grammarTotal ?? 0,
    grammarStartedPct,
    grammarKnown: grammarKnown ?? 0,
    grammarMasteredPct,
    vocabAcc: sessionStats('vocab'),
    grammarAcc: sessionStats('grammar'),
    listenAcc: sessionStats('listen'),
  };
}
