-- Track the current consecutive-wrong streak per quiz item, so review ordering
-- can surface items missed more than twice in a row first (the owner's rule).
-- Increments on a wrong answer, resets to 0 on a correct one — maintained in
-- app/api/vocab/grade. Starts at 0 for existing items and builds from here;
-- a consecutive streak can't be reconstructed from the correct/wrong totals.
--
-- Applied to the Passet Supabase project on 2026-10-01.
alter table public.vocab_items add column if not exists wrong_streak integer not null default 0;
