-- Data backfill: bring "legacy" words into the per-item vocab review rotation.
--
-- 104 words from the old lesson flow lived only in user_progress and were never
-- expanded into vocab_items, so the current vocab flow (which reviews
-- vocab_items) never surfaced them. Create ONE lemma review-item per such word,
-- deterministically from the word's existing lemma + translation (no LLM). They
-- enter as introduced=true review items with staggered due dates so they don't
-- flood review at once; mastery is mirrored from the word's user_progress status.
--
-- If richer coverage (inflected forms, phrases) is wanted for these words later,
-- that's a separate LLM generation step.
--
-- Applied to the Passet Supabase project on 2026-10-01 (104 items inserted).
with candidates as (
  select up.word_id, up.status, w.lemma, w.pos, w.translation,
         row_number() over (order by w.lemma) as rn
  from user_progress up
  join words w on w.id = up.word_id
  where not exists (select 1 from vocab_items vi where vi.word_id = up.word_id)
    and w.translation is not null and length(trim(w.translation)) > 0
)
insert into vocab_items
  (word_id, kind, label, prompt_en, answer_sv, interval_days, next_review_date, times_correct, status, introduced)
select
  word_id,
  'lemma',
  pos,
  translation,
  lemma,
  case when status = 'known' then 21 else 0 end,
  case when status = 'known' then current_date + 21 else current_date + ((rn)::int % 14) end,
  case when status = 'known' then 2 else 0 end,
  status,
  true
from candidates;
