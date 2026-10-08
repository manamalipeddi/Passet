-- Data fix: correct wrong/unnatural Swedish in generated phrase vocab_items,
-- found in a manual audit of all 137 phrases (prompted by "prata till", which
-- should be "prata med"). These were LLM-generated and slipped through. note and
-- example are cleared so any stale example sentence using the bad phrase
-- regenerates. Borderline/stylistic cases were left for the owner to decide.
--
-- Applied to the Passet Supabase project on 2026-10-08.
update vocab_items set answer_sv='prata med',          note=null, example=null where kind='phrase' and answer_sv='prata till';          -- "talk to"
update vocab_items set answer_sv='av den anledningen',  note=null, example=null where kind='phrase' and answer_sv='för den anledningen'; -- "for that reason"
update vocab_items set answer_sv='för tillfället',      note=null, example=null where kind='phrase' and answer_sv='för nu';              -- "for now"
update vocab_items set answer_sv='i tid',               note=null, example=null where kind='phrase' and answer_sv='på tid';              -- "on time"
update vocab_items set answer_sv='hur är det med',      note=null, example=null where kind='phrase' and answer_sv='vad med';             -- "what about"
update vocab_items set answer_sv='vill inte',           note=null, example=null where kind='phrase' and answer_sv='inte vill';           -- "don't want to" (main-clause order)
update vocab_items set answer_sv='pågår fortfarande',   note=null, example=null where kind='phrase' and answer_sv='fortfarande pågår';   -- "still going on"
update vocab_items set answer_sv='väntar fortfarande',  note=null, example=null where kind='phrase' and answer_sv='fortfarande väntar';  -- "still waiting"
update vocab_items set answer_sv='hittills',            note=null, example=null where kind='phrase' and answer_sv='så långt';            -- "so far" (temporal)
