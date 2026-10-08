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

-- Second pass: the owner asked to fix the borderline/context-dependent ones too.
update vocab_items set answer_sv='jag vet det',   note=null, example=null where kind='phrase' and answer_sv='jag vet den';    -- "I know it" (generic it → det)
update vocab_items set answer_sv='jag gillar det', note=null, example=null where kind='phrase' and answer_sv='jag gillar den'; -- "I like it" (generic it → det)
update vocab_items set answer_sv='det är hon',     note=null, example=null where kind='phrase' and answer_sv='det är henne';  -- "it's her" (subject form)
update vocab_items set answer_sv='ett par',        note=null, example=null where kind='phrase' and answer_sv='två';          -- "a couple of"
update vocab_items set answer_sv='kunna',          note=null, example=null where kind='phrase' and answer_sv='kunna vara';   -- "to be able to"
update vocab_items set answer_sv='itu',            note=null, example=null where kind='phrase' and answer_sv='i två';        -- "in two"
update vocab_items set answer_sv='sammanlagt',     note=null, example=null where id='49419114-7e37-454b-a99f-01fb03a54e7d';  -- "altogether / in total"
update vocab_items set answer_sv='allihop',        note=null, example=null where id='bf13186f-beb8-48f1-b72d-e9c1b046a953';  -- "all together"
