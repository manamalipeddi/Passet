import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { READY_FOR_NEW } from '@/lib/config';

const PRACTICE_MODES = ['words', 'grammar', 'extra'];

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode: string = typeof body.mode === 'string' ? body.mode : 'daily';
  const supabase = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // After a strong run of practice, nudge toward new material.
  let ready_for_new = false;
  let recent_accuracy = 0;
  if (PRACTICE_MODES.includes(mode)) {
    const { data: recent } = await supabase
      .from('attempts')
      .select('is_correct')
      .order('created_at', { ascending: false })
      .limit(READY_FOR_NEW.minAttempts);
    if (recent && recent.length >= READY_FOR_NEW.minAttempts) {
      recent_accuracy = recent.filter((a: any) => a.is_correct).length / recent.length;
      if (recent_accuracy >= READY_FOR_NEW.accuracy) {
        // Only nudge if there's genuinely something new left to learn
        const [{ count: totalWords }, { count: startedWords }, { count: grammarTotal }, { count: grammarStarted }] =
          await Promise.all([
            supabase.from('words').select('*', { count: 'exact', head: true }),
            supabase.from('user_progress').select('*', { count: 'exact', head: true }),
            supabase.from('grammar_points').select('*', { count: 'exact', head: true }),
            supabase.from('user_grammar_progress').select('*', { count: 'exact', head: true }),
          ]);
        ready_for_new =
          (totalWords ?? 0) > (startedWords ?? 0) || (grammarTotal ?? 0) > (grammarStarted ?? 0);
      }
    }
  }

  const { data: state } = await supabase.from('streak_state').select('*').eq('id', 1).single();
  if (!state) return NextResponse.json({ error: 'no_state' }, { status: 500 });

  if (state.last_practiced_date === today) {
    return NextResponse.json({ streak: state.current_streak, already_done: true, ready_for_new, recent_accuracy });
  }

  let streak = 1;
  if (state.last_practiced_date) {
    const gap = Math.round(
      (new Date(today).getTime() - new Date(state.last_practiced_date).getTime()) / 86400000
    );
    streak = gap === 1 ? state.current_streak + 1 : 1;
  }

  await supabase
    .from('streak_state')
    .update({ current_streak: streak, last_practiced_date: today, total_days: state.total_days + 1 })
    .eq('id', 1);

  return NextResponse.json({ streak, already_done: false, ready_for_new, recent_accuracy });
}
