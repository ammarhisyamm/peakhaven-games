-- Why a run was flagged, in its own words, and more than one of them. Run this once in the Supabase SQL
-- editor to upgrade an existing project; it is idempotent, so re-running it changes nothing.
--
-- Until now a run carried a single boolean and the admin page said one fixed sentence, because there was
-- exactly one way to be flagged: the score the browser sent did not match the score its replay produced.
-- There are now several, and a run can be caught by more than one of them at once:
--
--   claim-mismatch   the browser's score did not match the one its replay produced
--   long-open        one stretch of the run took a long time, so somebody had that seed in hand for a
--                    while before submitting a replay for it. Measured a segment at a time: one Sequence
--                    level, or the whole of a Blocks or Ridge run, never the run's total sitting
--   score-outlier    the verified score is several times the player's own previous best in that game
--   fast-moves       the inputs came faster than a hand moves, sustained over the run
--
-- So the reasons are kept on the run as a list, each one a small object holding the sentence an admin
-- reads and the numbers it was built from:
--
--   [{"code": "long-open", "segmentSeconds": 2820, "segment": 6, "text": "Level 6 took 47 min."},
--    {"code": "score-outlier", "score": 48200, "previousBest": 9850, "priorRuns": 7,
--     "text": "Scored 48,200, more than 3x their previous best of 9,850 over 7 earlier runs."}]
--
-- The sentence is stored rather than rebuilt, so a run reviewed next month still says what it said when it
-- was flagged, even if a threshold has moved since. The code and the numbers are stored beside it so the
-- flags can be counted and calibrated later without parsing English.
--
-- None of this rejects a run or changes a score. A flagged run keeps counting until an admin decides
-- otherwise, exactly as before.
--
-- Until this has run the arcade carries on without it: runs are still flagged, still listed and still
-- reviewable, and the admin page falls back to the single sentence it showed before.

alter table public.runs add column if not exists flag_reasons jsonb not null default '[]'::jsonb;

-- A list, never a bare object or a string, so the page can always iterate it.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'runs_flag_reasons_is_array') then
    alter table public.runs add constraint runs_flag_reasons_is_array
      check (jsonb_typeof(flag_reasons) = 'array');
  end if;
end $$;

-- Matching supabase/tighten-grants.sql. Nothing in the browser reads `runs` directly — every read goes
-- through /api with the service role — and row-level security on the table has no policy, so today nothing
-- is exposed either way. This is the same belt-and-braces the other migrations write: the column arrives
-- with no browser grant behind it rather than relying on a sweep having been run earlier. Re-asserting the
-- revoke on the whole table is harmless and idempotent, and `runs` has never had a policy to break.
revoke all on public.runs from public, anon, authenticated;

--   Flagged runs and why:   select id, game, day, score, jsonb_pretty(flag_reasons)
--                             from public.runs where flagged order by updated_at desc;
--   One flag's frequency:   select r->>'code' as code, count(*) from public.runs,
--                             jsonb_array_elements(flag_reasons) r group by 1 order by 2 desc;
--   Runs with two or more:  select id, game, day, jsonb_array_length(flag_reasons) as flags
--                             from public.runs where jsonb_array_length(flag_reasons) > 1;
