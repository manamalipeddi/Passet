# Passet

A personal daily Swedish practice app with two separate tracks:

- **Vocabulary** (`/vocab`) — fast word acquisition, no sentence generation. Every word
  expands into several **items** — the dictionary form plus its inflected forms (verb
  tenses, noun forms, adjective degrees) and a few short phrases — each tracked with its
  own spaced-repetition schedule (table `vocab_items`), so you can master "bor" while still
  drilling "bodde". The Swedish forms come straight from `words.forms`; only the English
  prompts and phrases are generated (Haiku, cached) — see `lib/vocabItems.ts`. Items are
  pre-generated into a buffer (`introduced=false`) and topped up in the background
  (`/api/vocab/topup`), so `/api/vocab/session` stays DB-only and fast. A normal session
  promotes up to 10 new items/day (user-added "heard" words first, then curriculum by rank)
  plus 10 spaced-repetition review items; `POST /api/vocab/session {mode:"review"}` practises
  what you already know without introducing anything new (`/vocab?mode=review`). Base words
  met for the first time get a see-Swedish / pick-English multiple choice with cached
  enrichment; everything is quizzed by typing the Swedish. After each answer, the feedback
  is about the exact item quizzed — a per-item note + example sentence using that form/phrase
  (`vocab_items.note` / `.example`, generated with the item, backfilled via
  `/api/vocab/fill-notes`). Typed answers are checked deterministically (typo/diacritic
  tolerant), falling back to Claude for nuance — which must always explain a wrong answer and
  glosses what you actually wrote. **Mastery is count-based:** a single-word answer is
  mastered after 2 correct, a multi-word answer (phrase or form like "har bott") after 5;
  mastered items are not retired but graduate to a 21-day ("mature") interval and keep
  cycling through spaced repetition. A word is "mastered" once all its items are. A soft cap
  nudges you at 10 new items/day.
- **Grammar** (`/lesson?mode=learn` to unlock the next point, `?mode=grammar` to drill) —
  grammar-focused translation exercises with generated sentences, graded with explanations.

## Setup

1. `npm install`
2. Set these environment variables (locally in `.env.local`, and in the Vercel project's
   Environment Variables settings for production):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`
3. `npm run dev` to run locally, or push to GitHub and import into Vercel for deployment.

The database schema and word/grammar data already exist in the connected Supabase project;
this repo is just the application code. Schema changes live as timestamped SQL files in
`migrations/` — apply new ones to the Supabase project (e.g. via the SQL editor) before
running the app. `20260910_vocab_redesign.sql` adds `words.enrichment` and the
`streak_state.vocab_new_date` / `vocab_new_today` daily counters; `20260911_vocab_items.sql`
adds the `vocab_items` table (per-form quiz items with their own spaced repetition);
`20260913_vocab_item_notes.sql` adds per-item `note`/`example`; `20260915_per_track_last_session.sql`
adds `streak_state.last_vocab_at` / `last_grammar_at` so the dashboard shows each track's last
session separately. After deploying, seed the item buffer by calling `POST /api/vocab/topup` a
few times (it generates items for the next few words per call); the app also tops it up in the
background as you use it.
