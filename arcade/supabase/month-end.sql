-- End-of-month results. Run this once in the Supabase SQL editor to upgrade an existing project; it is
-- idempotent, so re-running it changes nothing. New projects get these tables from schema.sql already.
--
-- Until this has run, the arcade keeps working without it: the leaderboard, /api/me and the games behave
-- normally, every board shows the default prize line, "Last month's winners" stays hidden, and the admin page
-- says to run this file first. Finalising a month is the only thing that needs these tables.

-- The top three of each game's monthly board, archived so last month's podium can be shown. Only rank 1 wins
-- a prize, so a month holds three winner rows out of nine. Ranks are positional, so equal scores are split by
-- whoever got there first and a game always has exactly one winner.
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

-- Row Level Security on with no policies, like every other table here: browsers cannot read or write these
-- directly, and every read and write goes through the /api functions with the service role key.
alter table public.month_results enable row level security;
alter table public.month_prizes enable row level security;

-- Set ARCADE_ADMIN_EMAILS on Vercel (Production and Preview) to the addresses that may finalise a month.
--
--   Last month's winners:  select * from public.month_results where month = '2026-09' and winner;
--   Backups for review:    select * from public.month_results where month = '2026-09' and not winner order by game, rank;
--   Prize lines:           select * from public.month_prizes;
