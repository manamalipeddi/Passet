import { getServiceClient } from '@/lib/supabase';
import ChatInterface from './ChatInterface';

export const dynamic = 'force-dynamic';

export default async function Chat() {
  const supabase = getServiceClient();
  // Load the most recent 60 messages (newest-first, then flip to chronological),
  // so a growing history never hides recent turns — including questions just
  // handed off from a lesson.
  const { data } = await supabase
    .from('chat_messages')
    .select('role, content')
    .order('created_at', { ascending: false })
    .limit(60);

  const initial = (data ?? []).reverse().map((m: any) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
    suggestedWords: [] as string[],
  }));

  return <ChatInterface initialMessages={initial} />;
}
