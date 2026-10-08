-- Data fix: audit of all non-phrase vocab_items (lemmas + inflected forms).
-- The lemmas and normal inflections were all correct; one hallucinated verb
-- form was removed — "har skolat" / "have willed; have shall'd", a bogus perfect
-- of the modal "ska" (which has no real perfect). Going forward, generated items
-- pass a verification step (lib/vocabItems.ts verifyItems) that would drop this.
--
-- Applied to the Passet Supabase project on 2026-10-08.
delete from vocab_items where answer_sv = 'har skolat';

-- Also removed (owner's call) two technically-valid but obscure/confusing items
-- that over-extended the modal "ska" into a full paradigm:
--   "skola"   = "to will; to shall"  — archaic infinitive, collides with skola=school
--   "varande" = "being"              — very rare present participle
delete from vocab_items where id in
  ('1a238f6b-3f06-49aa-9a07-6ab836bd883e', '95c1e988-9d8e-48d8-836f-c063bcfeb212');
