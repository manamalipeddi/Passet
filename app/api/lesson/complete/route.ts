import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST() {
  const supabase = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: state } = await supabase.from('streak_state').select('*').eq('id', 1).single();
  if (!state) return NextResponse.json({ error: 'no_state' }, { status: 500 });

  if (state.last_practiced_date === today) {
    return NextResponse.json({ streak: state.current_streak, already_done: true });
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

  return NextResponse.json({ streak, already_done: false });
}
