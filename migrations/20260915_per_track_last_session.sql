-- Track the last practice time per track (vocabulary vs grammar) separately, so
-- the dashboard can show "last vocab session" and "last grammar session" apart
-- from the single global last_session_at.
--
-- Stamped in app/api/lesson/complete: mode='words' updates last_vocab_at, every
-- other mode updates last_grammar_at. Backfilled from attempts history — grammar
-- attempts carry grammar_point_ids, vocab attempts don't.
--
-- Applied to the Passet Supabase project on 2026-09-15.
alter table public.streak_state add column if not exists last_vocab_at   timestamptz;
alter table public.streak_state add column if not exists last_grammar_at timestamptz;

update public.streak_state set
  last_vocab_at = coalesce(
    last_vocab_at,
    (select max(created_at) from public.attempts where coalesce(array_length(grammar_point_ids, 1), 0) = 0)
  ),
  last_grammar_at = coalesce(
    last_grammar_at,
    (select max(created_at) from public.attempts where coalesce(array_length(grammar_point_ids, 1), 0) > 0)
  )
where id = 1;
