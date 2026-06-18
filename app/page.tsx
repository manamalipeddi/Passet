import { getServiceClient } from '@/lib/supabase';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = getServiceClient();
  const { data: state } = await supabase.from('streak_state').select('*').eq('id', 1).single();
  const { count: knownWords } = await supabase
    .from('user_progress')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'known');
  const { count: totalWords } = await supabase.from('words').select('*', { count: 'exact', head: true });

  return (
    <div className="wrap">
      <div className="muted" style={{ textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 11 }}>
        15 minutes, most days
      </div>
      <h1>Passet</h1>
      <div className="card">
        <div style={{ fontSize: 28, fontWeight: 700, color: '#E8A33D' }}>{state?.current_streak ?? 0}</div>
        <div className="muted">day streak · {knownWords ?? 0} of {totalWords ?? 0} words known</div>
        <Link href="/lesson">
          <button className="btn btn-primary" style={{ marginTop: 18 }}>Start today's paus</button>
        </Link>
        <Link href="/lesson?mode=extra">
          <button className="btn btn-secondary" style={{ marginTop: 10 }}>Practice more (won't add new words)</button>
        </Link>
      </div>
    </div>
  );
}
