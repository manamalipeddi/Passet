import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

// Google Cloud Text-to-Speech for the listening module. Uses the REST endpoint
// with a simple API key (GOOGLE_TTS_API_KEY) — no service-account JSON needed.
// Audio is cached by (voice, rate, text) so a repeated sentence never re-bills.
// Returns { audio } as base64 MP3; the client plays it as a data URI. If the key
// is missing or the call fails, responds with an error and the client falls back
// to the device voice, so listening keeps working.

const VOICE = 'sv-SE-Wavenet-A';   // native Swedish WaveNet voice
const LANG = 'sv-SE';

export async function POST(req: Request) {
  const { text, slow } = await req.json().catch(() => ({}));
  const t = (text ?? '').trim();
  if (!t) return NextResponse.json({ error: 'no_text' }, { status: 400 });

  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'tts_unconfigured' }, { status: 503 });

  const speakingRate = slow ? 0.7 : 1.0;
  const cacheKey = `${VOICE}|${speakingRate}|${t}`;
  const supabase = getServiceClient();

  const { data: cached } = await supabase
    .from('tts_cache').select('audio_base64').eq('cache_key', cacheKey).maybeSingle();
  if (cached?.audio_base64) return NextResponse.json({ audio: cached.audio_base64 });

  let audio: string | undefined;
  try {
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: t },
        voice: { languageCode: LANG, name: VOICE },
        audioConfig: { audioEncoding: 'MP3', speakingRate },
      }),
    });
    if (!res.ok) {
      console.error('[listen/tts] Google TTS failed:', res.status, await res.text().catch(() => ''));
      return NextResponse.json({ error: 'tts_failed' }, { status: 502 });
    }
    audio = (await res.json())?.audioContent;
  } catch (e) {
    console.error('[listen/tts] Google TTS error:', e);
    return NextResponse.json({ error: 'tts_failed' }, { status: 502 });
  }
  if (!audio) return NextResponse.json({ error: 'tts_failed' }, { status: 502 });

  await supabase.from('tts_cache').insert({ cache_key: cacheKey, audio_base64: audio });
  return NextResponse.json({ audio });
}
