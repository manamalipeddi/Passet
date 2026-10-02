-- Cache of synthesized speech (Google Cloud TTS) for the listening module, so a
-- repeated sentence is spoken from cache instead of re-billing the TTS API.
-- cache_key = "<voice>|<rate>|<text>"; audio_base64 is the MP3 as base64.
--
-- Applied to the Passet Supabase project on 2026-10-02.
create table if not exists public.tts_cache (
  cache_key text primary key,
  audio_base64 text not null,
  created_at timestamptz not null default now()
);
