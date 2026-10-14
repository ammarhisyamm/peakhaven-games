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
