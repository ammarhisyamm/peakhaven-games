-- Achievements. Run this once in the Supabase SQL editor; it is idempotent, so re-running it changes nothing.
--
-- One row per run that has been verified and committed, holding only the numbers that run's own replay
-- produced. Nothing a browser sent is ever stored here: /api/finish works the stats out from the replay it
-- has just re-played on the server (arcade/server/verify.mjs), and that is the only writer.
--
-- Why a row per run rather than a running total per player:
--
--   A refund takes a paid run off the boards by marking it `rejected`, and a run rejected at verification
--   was never counted in the first place. With one row per run, "a rejected or refunded run never counts"
--   is true by construction — the row is either never written, or it goes away with the run — instead of
--   depending on a subtraction somewhere getting it right. The totals are worked out on read, the same way
--   the leaderboards already are, over at most a few hundred rows per player.
--
-- The trigger below is what makes the refund half of that true. `public.refund_purchase` (paid-tries.sql)
-- marks the runs it refunds as rejected from inside the database, so nothing in /api is on that path; the
-- trigger catches it there, and catches every other way a run could ever be rejected after the fact.
--
-- Grants follow tighten-grants.sql exactly: row-level security on, not one policy, nothing at all for the
-- browser keys, and the service role — which is what /api uses — left holding the table. The roles are
-- named conditionally so this file also runs against a plain Postgres, which is how tools/verify-sql.mjs
-- checks it before it ever reaches production.

-- 1. The table.
create table if not exists public.run_achievements (
  run_id uuid primary key references public.runs(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  game text not null check (game in ('blocks','sequence','ridge')),
  -- The run's own numbers, named by the metrics in arcade/ui/achievements.js: for Peak Blocks
  -- {score, combo, levels}, for Sequence {cascade, powerups}, for Ridge Run {zones, close, vials}.
  -- A Sequence run verifies one level at a time and folds each level into this one row: a best keeps the
  -- higher number, a lifetime tally adds up.
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- Every read is "this player's rows", so that is the index.
create index if not exists run_achievements_player on public.run_achievements (player_id);

-- 2. Row-level security on, with no policy at all: exactly like month_results and month_prizes, this table
--    is for the service role and nobody else. A policy added here later would be the only way in, which is
--    the point of leaving it with none.
alter table public.run_achievements enable row level security;

-- 3. The grants. Browser keys get nothing; the service role gets the table. anon, authenticated and
--    service_role only exist on a real Supabase project, so each is named only if it is there.
do $$
declare grantees text;
begin
  select string_agg(quote_ident(rolname), ', ') into grantees
    from pg_roles where rolname in ('anon', 'authenticated');
  execute format('revoke all on public.run_achievements from %s', concat_ws(', ', 'public', grantees));
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.run_achievements to service_role';
  end if;
end $$;

-- 4. A run that stops counting stops counting here too.
--
--    A refund marks its runs rejected inside the database, so this cannot live in /api. It is written as a
--    delete rather than a flag so that a read never has to remember to filter, and so that re-earning the
--    same achievement later is a fresh row rather than a resurrection.
create or replace function public.drop_run_achievements() returns trigger
language plpgsql
set search_path = public
as $$
begin
  delete from public.run_achievements where run_id = new.id;
  return new;
end $$;

-- No browser key, and no bare PUBLIC, may call it. tools/verify-grants.mjs fails if any function in public
-- is ever left executable by PUBLIC or by a browser key, which is what keeps this true.
do $$
declare grantees text;
begin
  select string_agg(quote_ident(rolname), ', ') into grantees
    from pg_roles where rolname in ('anon', 'authenticated');
  execute format('revoke all on function public.drop_run_achievements() from %s',
    concat_ws(', ', 'public', grantees));
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.drop_run_achievements() to service_role';
  end if;
end $$;

drop trigger if exists runs_rejected_drops_achievements on public.runs;
create trigger runs_rejected_drops_achievements
  after update of status on public.runs
  for each row
  when (new.status = 'rejected' and old.status is distinct from 'rejected')
  execute function public.drop_run_achievements();

-- What to expect afterwards:
--   select count(*) from public.run_achievements;                        -- 0 on a fresh install
--   select relrowsecurity from pg_class where oid = 'public.run_achievements'::regclass;   -- t
--   select count(*) from pg_policies where tablename = 'run_achievements';                 -- 0
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'run_achievements' order by 1, 2;
--                                                  -- service_role (and the owner) only; no anon,
--                                                  -- no authenticated, no PUBLIC
