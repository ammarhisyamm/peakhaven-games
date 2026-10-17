-- Why a run was flagged, in numbers. Run this once in the Supabase SQL editor to upgrade an existing
-- project; it is idempotent, so re-running it changes nothing. New projects get it from schema.sql already.
--
-- A run is flagged when the score a browser sent does not match the score its replay produces. Until now only
-- the fact was kept, so the admin page could say no more than "the score did not match its replay". These two
-- columns keep the pair of numbers, which is the thing an admin actually needs to judge it: a run claiming
-- 12,400 against a verified 9,850 is a different conversation from one claiming 9,851.
--
-- Both are the run's running total at the moment it was written, so they compare directly with each other and
-- with the score on the leaderboard. verified_score is written on every finish; claimed_score only when a
-- claim disagreed, so it stays null on an honest run and is not overwritten by later honest segments.
--
-- Until this has run the arcade carries on without it: runs are still flagged, still listed and still
-- reviewable, and the admin page shows the fixed sentence it showed before instead of the numbers.

alter table public.runs add column if not exists claimed_score int;
alter table public.runs add column if not exists verified_score int;

--   Flagged runs and the gap:  select id, game, day, score, claimed_score, verified_score
--                                from public.runs where flagged order by updated_at desc;
--   The worst offenders:       select player_id, max(claimed_score - verified_score) as gap
--                                from public.runs where claimed_score is not null group by player_id order by gap desc;
