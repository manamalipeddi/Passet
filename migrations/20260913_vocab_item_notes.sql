-- Per-item feedback context. After answering a quiz item, we want the note that
-- appears to be about the ITEM being quizzed (the exact form or phrase), not the
-- parent word — e.g. for "jag vill" explain "vill / jag vill", not "jag".
--
--   note      a short usage explanation of this specific item/phrase
--   example   {"sv": "...", "en": "..."} — one example sentence using this item
--
-- Generated per item (Haiku, cached) alongside the item itself; see
-- lib/vocabItems.ts. Existing items are backfilled via /api/vocab/fill-notes.
--
-- Applied to the Passet Supabase project on 2026-09-13.
alter table public.vocab_items add column if not exists note    text;
alter table public.vocab_items add column if not exists example jsonb;
