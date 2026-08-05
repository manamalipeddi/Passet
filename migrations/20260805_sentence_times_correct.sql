-- Track how many times each cached sentence has been answered correctly.
-- Once a sentence hits 4 correct answers it's retired from practice rotation
-- (see app/api/lesson/generate/route.ts fetchCached: .lt('times_correct', 4)).
alter table generated_sentences
  add column if not exists times_correct integer not null default 0;
