-- Granular vocabulary items: every word expands into several quiz-able items —
-- the dictionary form plus its inflected forms (verb tenses, noun forms,
-- adjective degrees) and a few short useful phrases — each tracked with its own
-- spaced-repetition schedule. This is what the vocab quiz now draws from, so you
-- can master "bor" while still drilling "bodde".
--
--   kind        'lemma' | 'verb_tense' | 'noun_form' | 'adj_form' | 'phrase'
--   label       short human label, e.g. 'past tense', 'definite plural', or the phrase
--   prompt_en   the English shown in the quiz ("lived", "have lived", "thinking about")
--   answer_sv   the Swedish the learner must type ("bodde", "har bott", "tänka på")
--   alt_sv      other acceptable answers (e.g. progressive forms that coincide)
--   introduced  false = generated into the buffer but not yet in the daily rotation
--
-- Swedish answers for grammatical forms come straight from words.forms (exact);
-- only the English prompts and phrases are generated (see lib/vocabItems.ts).
--
-- Applied to the Passet Supabase project on 2026-09-11.
create table if not exists public.vocab_items (
  id               uuid primary key default gen_random_uuid(),
  word_id          uuid not null references public.words(id) on delete cascade,
  kind             text not null,
  label            text,
  prompt_en        text not null,
  answer_sv        text not null,
  alt_sv           text[] not null default '{}',
  ease_factor      real not null default 2.5,
  interval_days    integer not null default 0,
  next_review_date date,
  last_reviewed_at timestamptz,
  times_correct    integer not null default 0,
  times_wrong      integer not null default 0,
  status           text not null default 'learning',
  introduced       boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (word_id, prompt_en)
);

create index if not exists vocab_items_introduced_idx on public.vocab_items (introduced);
create index if not exists vocab_items_review_idx     on public.vocab_items (introduced, next_review_date);
create index if not exists vocab_items_word_idx       on public.vocab_items (word_id);
