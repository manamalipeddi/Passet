# Passet

A personal daily Swedish practice app with two separate tracks:

- **Vocabulary** (`/vocab`) — fast word acquisition, no sentence generation. Each day
  introduces up to 10 new words (user-added "heard" words first, then curriculum by
  frequency rank) as a see-Swedish / pick-English multiple choice, each with cached
  enrichment (a few example uses + a memorable note). A quiz then shows English and you
  type the Swedish: 10 of today's words + 10 spaced-repetition review words. Typed answers
  are checked deterministically (typo/diacritic tolerant) and only fall back to Claude for
  nuance. A soft cap nudges you at 10 new words/day but never blocks.
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
running the app. The latest, `20260910_vocab_redesign.sql`, adds `words.enrichment` and the
`streak_state.vocab_new_date` / `vocab_new_today` daily counters used by the vocab flow.
