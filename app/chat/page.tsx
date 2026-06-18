import { getServiceClient } from '@/lib/supabase';
import ChatInterface from './ChatInterface';

export const dynamic = 'force-dynamic';

export default async function Chat() {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from('chat_messages')
    .select('role, content')
    .order('created_at', { ascending: true })
    .limit(60);

  const initial = (data ?? []).map((m: any) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
    suggestedWords: [] as string[],
  }));

  return <ChatInterface initialMessages={initial} />;
}
