-- Track the all-time longest streak alongside the current one, for a little
-- "beat your best" gamification on the dashboard.
--
-- Maintained in app/api/lesson/complete: whenever the current streak advances,
-- longest_streak = max(longest_streak, current_streak). Backfilled to the
-- current streak for the existing row so today's run isn't already "behind".
--
-- Applied to the Passet Supabase project on 2026-09-27.
alter table public.streak_state add column if not exists longest_streak integer not null default 0;

update public.streak_state
  set longest_streak = greatest(coalesce(longest_streak, 0), coalesce(current_streak, 0))
  where id = 1;
