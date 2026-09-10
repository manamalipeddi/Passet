-- Vocabulary redesign: fast word acquisition, sentences left to grammar.
--
-- 1) words.enrichment — a small, cached "so it sticks" bundle per word, generated
--    once (lazily) when the word is first introduced in the vocab learn phase and
--    reused forever. Shown in full at introduction and as a short reminder in the
--    quiz. Shape:
--      {
--        "uses": [ { "sv": "Jag dricker kaffe.", "en": "I drink coffee." }, ... up to 5 ],
--        "note": "a memorable/mnemonic note about the word"
--      }
--
-- 2) streak_state daily vocab counters — power the "soft cap" of ~10 new words a
--    day. vocab_new_date is the calendar date the count applies to; vocab_new_today
--    is how many brand-new words have been introduced on that date. The vocab
--    session resets the count when the date rolls over, and never blocks — it only
--    lets the finish screen say "that's your 10 for today" vs. "bonus round".
--
-- Applied to the Passet Supabase project on 2026-09-10.
alter table public.words
  add column if not exists enrichment jsonb;

alter table public.streak_state
  add column if not exists vocab_new_date date;

alter table public.streak_state
  add column if not exists vocab_new_today integer not null default 0;
