-- Data fix: audit of all non-phrase vocab_items (lemmas + inflected forms).
-- The lemmas and normal inflections were all correct; one hallucinated verb
-- form was removed — "har skolat" / "have willed; have shall'd", a bogus perfect
-- of the modal "ska" (which has no real perfect). Going forward, generated items
-- pass a verification step (lib/vocabItems.ts verifyItems) that would drop this.
--
-- Applied to the Passet Supabase project on 2026-10-08.
delete from vocab_items where answer_sv = 'har skolat';
