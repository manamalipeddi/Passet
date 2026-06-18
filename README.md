# Passet

A personal daily Swedish practice app: spaced-repetition vocabulary (top frequency words,
with full grammatical forms) plus grammar-focused translation exercises, graded with explanations.

## Setup

1. `npm install`
2. Set these environment variables (locally in `.env.local`, and in the Vercel project's
   Environment Variables settings for production):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`
3. `npm run dev` to run locally, or push to GitHub and import into Vercel for deployment.

The database schema and word/grammar data already exist in the connected Supabase project;
this repo is just the application code.
