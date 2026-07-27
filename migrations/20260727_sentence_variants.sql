-- Cache the "tense forms + noun plurals" study aid for an English->Swedish
-- practice sentence. Generated once (lazily) per grammar-focused en_to_sv
-- sentence and reused, since sentences themselves are cached and re-shown.
--
-- Shape:
--   {
--     "forms": [ { "en": "he plays with her", "sv": "han leker med henne",
--                  "tense": "simple present", "isMain": true } , ... ],
--     "nouns": [ { "lemma": "katt", "gloss": "cat", "gender": "en",
--                  "indefSing": "en katt", "defSing": "katten",
--                  "indefPlural": "katter", "defPlural": "katterna" } , ... ]
--   }
--
-- Applied to the Passet Supabase project on 2026-07-27.
alter table public.generated_sentences
  add column if not exists variants jsonb;
