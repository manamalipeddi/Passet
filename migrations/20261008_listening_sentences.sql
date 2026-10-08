-- Dedicated pool of listening/dictation sentences, decoupled from the SRS used
-- for vocab/grammar (SRS doesn't fit listening — it's not memorization). A
-- sentence is "retired" once answered correctly twice in a row (correct_streak
-- >= 2); the session generates fresh sentences from already-learned vocabulary
-- when the un-retired pool runs low. See app/api/listen/session.
--
-- Applied to the Passet Supabase project on 2026-10-08.
create table if not exists public.listening_sentences (
  id uuid primary key default gen_random_uuid(),
  sentence_sv text not null,
  sentence_en text not null,
  correct_streak integer not null default 0,
  times_shown integer not null default 0,
  last_shown_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists listening_sentences_active_idx
  on public.listening_sentences (correct_streak, times_shown, last_shown_at);
