-- Track the precise moment of the most recent practice session (not just the
-- calendar date in last_practiced_date). Used to show "today at 14:30",
-- "yesterday", "3 days ago" on the home page and to give the tutor agent a
-- sense of recency. Backfill the existing row from the known last practiced date.
--
-- Applied to the Passet Supabase project on 2026-07-27.
alter table public.streak_state
  add column if not exists last_session_at timestamptz;

update public.streak_state
  set last_session_at = last_practiced_date::timestamptz
  where last_session_at is null and last_practiced_date is not null;
