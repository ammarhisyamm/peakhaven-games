-- PH Arcade competition tables. Run once in the Supabase SQL editor (safe to re-run).
-- Row Level Security is on with no policies, so browsers can't read or write these tables directly:
-- every read and write goes through the /api functions, which use the service role key.

create table if not exists public.invites (
  code text primary key,
  max_uses int not null default 1 check (max_uses > 0),
  uses int not null default 0 check (uses >= 0),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 24),
  bottle text not null default 'ph-original',
  invite_code text references public.invites(code),
  created_at timestamptz not null default now()
);

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  game text not null check (game in ('blocks','sequence','ridge')),
  day text not null,                          -- Melbourne calendar day, YYYY-MM-DD
  seed bigint not null,
  level int not null default 1,
  segments int not null default 0,            -- verified submissions (Sequence: levels played)
  score int not null default 0,
  status text not null default 'open' check (status in ('open','closed','rejected')),
  flagged boolean not null default false,     -- claimed score didn't match the replay: worth a look
  reject_reason text,
  replays jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists runs_player_day on public.runs (player_id, day, game);
create index if not exists runs_scored on public.runs (day) where status <> 'rejected' and score > 0;

alter table public.invites enable row level security;
alter table public.players enable row level security;
alter table public.runs enable row level security;

-- Uses one invite, only if it has uses left. Returns true when it worked.
create or replace function public.use_invite(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.invites set uses = uses + 1 where code = p_code and uses < max_uses;
  return found;
end $$;

-- Counts today's plays and starts a run in one locked step, so two quick taps can't both take the last play.
-- Any run of the same game still open is closed first (it keeps whatever score was verified).
create or replace function public.start_run(p_player uuid, p_game text, p_day text, p_seed bigint, p_limit int)
returns setof public.runs
language plpgsql security definer set search_path = public as $$
declare used int;
begin
  perform pg_advisory_xact_lock(hashtext(p_player::text || ':' || p_game || ':' || p_day));
  select count(*) into used from public.runs where player_id = p_player and game = p_game and day = p_day;
  if used >= p_limit then return; end if;
  update public.runs set status = 'closed', finished_at = now()
    where player_id = p_player and game = p_game and status = 'open';
  return query insert into public.runs (player_id, game, day, seed) values (p_player, p_game, p_day, p_seed) returning *;
end $$;

revoke all on function public.use_invite(text) from public, anon, authenticated;
revoke all on function public.start_run(uuid, text, text, bigint, int) from public, anon, authenticated;
grant execute on function public.use_invite(text) to service_role;
grant execute on function public.start_run(uuid, text, text, bigint, int) to service_role;

-- Handy queries for running the competition (run them in the SQL editor):
--   New invite codes:   insert into public.invites (code, max_uses, note) values ('PEAK-7Q2X', 1, 'for Sam');
--   Flagged runs:       select * from public.runs where flagged or status = 'rejected' order by updated_at desc;
--   A player's best:    select game, max(score) from public.runs where player_id = '...' and status <> 'rejected' group by game;
-- Upgrade existing projects before deploying the retry-safe start client. Existing five-argument callers keep working.
alter table public.runs add column if not exists request_id uuid;
create unique index if not exists runs_player_request on public.runs (player_id, request_id) where request_id is not null;
create or replace function public.start_run(p_player uuid, p_game text, p_day text, p_seed bigint, p_limit int, p_request uuid)
returns setof public.runs
language plpgsql security definer set search_path = public as $$
declare used int;
begin
  perform pg_advisory_xact_lock(hashtext(p_player::text || ':' || p_game || ':' || p_day));
  if p_request is not null and exists(select 1 from public.runs where player_id=p_player and request_id=p_request) then
    return query select * from public.runs where player_id=p_player and request_id=p_request;
    return;
  end if;
  select count(*) into used from public.runs where player_id=p_player and game=p_game and day=p_day;
  if used >= p_limit then return; end if;
  update public.runs set status='closed', finished_at=now() where player_id=p_player and game=p_game and status='open';
  return query insert into public.runs (player_id,game,day,seed,request_id) values (p_player,p_game,p_day,p_seed,p_request) returning *;
end $$;
revoke all on function public.start_run(uuid,text,text,bigint,int,uuid) from public, anon, authenticated;
grant execute on function public.start_run(uuid,text,text,bigint,int,uuid) to service_role;

-- End of month. The top three of each game's monthly board are archived here so last month's podium can be
-- shown, but only rank 1 wins a prize: three winners a month. Ranks are positional, so equal scores are split
-- by whoever got there first and a game always has exactly one winner.
create table if not exists public.month_results (
  month text not null,                        -- Melbourne calendar month, YYYY-MM
  game text not null check (game in ('blocks','sequence','ridge')),
  rank int not null check (rank between 1 and 3),
  player_id uuid not null references public.players(id) on delete cascade,
  score int not null,
  winner boolean not null default false,      -- rank 1 only: this is who gets contacted about the prize
  finalised_at timestamptz not null default now(),
  primary key (month, game, rank)
);
create index if not exists month_results_winners on public.month_results (month) where winner;

-- One line of prize text per game, shown under that game's leaderboard. Blank falls back to a default line.
create table if not exists public.month_prizes (
  game text primary key check (game in ('blocks','sequence','ridge')),
  text text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.month_results enable row level security;
alter table public.month_prizes enable row level security;

--   Last month's winners:  select * from public.month_results where month = '2026-09' and winner;
--   Backups for review:    select * from public.month_results where month = '2026-09' and not winner order by game, rank;

-- Existing projects: the two tables above also live in month-end.sql, which is safe to run on its own.
