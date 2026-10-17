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
  claimed_score int,                          -- what the browser claimed, when it disagreed; null on an honest run
  verified_score int,                         -- what the replay actually produced, written on every finish
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

-- Paid extra tries. One coin buys one extra run of any ranked game once that game’s three free tries for the
-- day are gone. Free tries are always used first, coins never expire and a paid run is an ordinary run on the
-- leaderboard. Existing projects: all of this also lives in paid-tries.sql, which is safe to run on its own.

-- A request to buy a pack. The player is shown the amount and the reference; the money arrives separately (a
-- bank transfer or PayID with that reference in its description) and an admin marks it paid, which is the only
-- thing that grants coins.
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  pack int not null check (pack > 0),          -- the pack's coin count, which is what identifies a pack
  coins int not null check (coins > 0),        -- coins granted when it is paid, copied from the pack
  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'AUD',
  reference text not null unique,              -- PHA-XXXX, what the player types into their banking app
  provider text not null default 'manual',     -- how it is being paid: 'manual' now, 'stripe' later
  status text not null default 'pending' check (status in ('pending','paid','cancelled','refunded')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text                             -- the admin email that marked it paid, cancelled or refunded
);
create index if not exists purchases_pending on public.purchases (created_at) where status = 'pending';
create index if not exists purchases_player on public.purchases (player_id, created_at desc);

-- Every coin in and every coin out, in order. The balance on players is a cache of this.
create table if not exists public.coin_ledger (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  delta int not null,                          -- +coins granted, -coins spent; 0 for an action worth logging only
  reason text not null check (reason in ('purchase','run','refund','admin')),
  purchase_id uuid references public.purchases(id) on delete set null,
  run_id uuid references public.runs(id) on delete set null,
  admin_email text,                            -- who did it, for anything an admin did by hand
  note text not null default '',
  created_at timestamptz not null default now()
);
-- One grant per purchase, however many times anyone clicks "Mark paid".
create unique index if not exists coin_ledger_one_grant on public.coin_ledger (purchase_id) where reason = 'purchase';
create index if not exists coin_ledger_player on public.coin_ledger (player_id, created_at, id);

-- The balance, cached on the player and only ever changed by the functions below.
alter table public.players add column if not exists coins int not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'players_coins_not_negative') then
    alter table public.players add constraint players_coins_not_negative check (coins >= 0);
  end if;
end $$;

-- Which runs a coin paid for. Free tries are counted on `not paid`, so a paid run never uses one up.
alter table public.runs add column if not exists paid boolean not null default false;
create index if not exists runs_player_day_free on public.runs (player_id, day, game) where not paid;

alter table public.purchases enable row level security;
alter table public.coin_ledger enable row level security;

-- A player may read their own purchases, their own ledger and their own row (which is where the balance is
-- cached), and nothing else. Every write goes through the service role and the functions below, so the
-- browser cannot touch a balance even though it holds a signed-in session.
revoke all on public.purchases from public, anon, authenticated;
revoke all on public.coin_ledger from public, anon, authenticated;
grant select on public.purchases to authenticated;
grant select on public.coin_ledger to authenticated;
drop policy if exists purchases_own_read on public.purchases;
create policy purchases_own_read on public.purchases for select to authenticated using (player_id = auth.uid());
drop policy if exists coin_ledger_own_read on public.coin_ledger;
create policy coin_ledger_own_read on public.coin_ledger for select to authenticated using (player_id = auth.uid());
drop policy if exists players_own_read on public.players;
create policy players_own_read on public.players for select to authenticated using (id = auth.uid());
-- The balance is cached on players, and a browser key still holds Postgres' default write grants on that
-- table: today nothing comes of it, because row-level security has no policy that exposes a row to write, but
-- that is the only thing standing in the way. A read policy added later for some other reason would be enough
-- to hand a player their own coins column. So the write grants go, and the service role keeps doing the
-- writing, which is already the only way /api changes a player.
revoke insert, update, delete, truncate, references, trigger on public.players from public, anon, authenticated;
grant select on public.players to authenticated;

-- Marks a purchase paid and grants its coins, once. Safe to call again: a second call changes nothing and
-- reports granted = false, because the unique index above lets only one grant row exist per purchase.
create or replace function public.grant_purchase(p_purchase uuid, p_admin text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.purchases; v_granted boolean := false; v_balance int;
begin
  select * into p from public.purchases where id = p_purchase for update;
  if not found then return jsonb_build_object('found', false); end if;
  if p.status = 'pending' then
    insert into public.coin_ledger (player_id, delta, reason, purchase_id, admin_email, note)
      values (p.player_id, p.coins, 'purchase', p.id, p_admin, 'Paid ' || p.reference)
      on conflict do nothing;
    if found then
      update public.players set coins = coins + p.coins where id = p.player_id;
      v_granted := true;
    end if;
    update public.purchases set status = 'paid', resolved_at = now(), resolved_by = coalesce(p_admin, resolved_by)
      where id = p.id returning * into p;
  end if;
  select coins into v_balance from public.players where id = p.player_id;
  return jsonb_build_object('found', true, 'granted', v_granted, 'status', p.status,
    'reference', p.reference, 'coins', p.coins, 'balance', coalesce(v_balance, 0));
end $$;

-- Closes a pending request without granting anything. Logged with a zero-coin ledger row, so the admin's
-- email is on the record either way.
create or replace function public.cancel_purchase(p_purchase uuid, p_admin text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.purchases; v_cancelled boolean := false;
begin
  select * into p from public.purchases where id = p_purchase for update;
  if not found then return jsonb_build_object('found', false); end if;
  if p.status = 'pending' then
    update public.purchases set status = 'cancelled', resolved_at = now(), resolved_by = p_admin
      where id = p.id returning * into p;
    insert into public.coin_ledger (player_id, delta, reason, purchase_id, admin_email, note)
      values (p.player_id, 0, 'admin', p.id, p_admin, 'Cancelled ' || p.reference);
    v_cancelled := true;
  end if;
  return jsonb_build_object('found', true, 'cancelled', v_cancelled, 'status', p.status, 'reference', p.reference);
end $$;

-- Gives or takes coins by hand, with a note saying why. Never goes below zero: taking more than the player has
-- empties the balance and logs what was actually taken.
create or replace function public.adjust_coins(p_player uuid, p_delta int, p_note text, p_admin text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_before int; v_after int;
begin
  if p_note is null or btrim(p_note) = '' then raise exception 'A note is required for a coin adjustment'; end if;
  select coins into v_before from public.players where id = p_player for update;
  if not found then return jsonb_build_object('found', false); end if;
  v_after := greatest(0, v_before + coalesce(p_delta, 0));
  if v_after <> v_before then update public.players set coins = v_after where id = p_player; end if;
  insert into public.coin_ledger (player_id, delta, reason, admin_email, note)
    values (p_player, v_after - v_before, 'admin', p_admin,
      case when v_after = v_before then p_note || ' (no change)' else p_note end);
  return jsonb_build_object('found', true, 'balance', v_after, 'delta', v_after - v_before);
end $$;

-- Refunds a paid purchase: takes back whatever of its coins are still unspent, and drops the runs its spent
-- coins paid for so they no longer count on any leaderboard.
--
-- Coins are spent oldest first, so the ledger is walked once with a queue of granted coins, each tagged with
-- whether it came from this purchase. A spend takes the oldest coin off the front; if that coin was this
-- purchase's and the spend started a run, that run was paid for by this purchase. Whatever is still in the
-- queue was never spent. refundPlan() in arcade/server/coins.mjs walks the same ledger the same way, and the
-- tests exercise that version.
create or replace function public.refund_purchase(p_purchase uuid, p_admin text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.purchases; r record;
  v_queue int[] := '{}'; v_runs uuid[] := '{}';
  v_unspent int; v_take int; v_balance int; v_from int;
begin
  select * into p from public.purchases where id = p_purchase for update;
  if not found then return jsonb_build_object('found', false); end if;
  select coins into v_balance from public.players where id = p.player_id for update;
  if p.status <> 'paid' then
    return jsonb_build_object('found', true, 'refunded', false, 'status', p.status, 'balance', coalesce(v_balance, 0));
  end if;
  for r in select delta, reason, run_id, purchase_id from public.coin_ledger
           where player_id = p.player_id order by created_at, id loop
    if r.delta > 0 then
      for i in 1..r.delta loop
        v_queue := v_queue || (case when r.reason = 'purchase' and r.purchase_id = p.id then 1 else 0 end);
      end loop;
    elsif r.delta < 0 then
      for i in 1..(-r.delta) loop
        if coalesce(array_length(v_queue, 1), 0) = 0 then exit; end if;
        v_from := v_queue[1];
        v_queue := v_queue[2:];
        if v_from = 1 and r.reason = 'run' and r.run_id is not null then v_runs := v_runs || r.run_id; end if;
      end loop;
    end if;
  end loop;
  select count(*) into v_unspent from unnest(v_queue) as q where q = 1;
  v_take := least(v_unspent, coalesce(v_balance, 0));
  if v_take > 0 then update public.players set coins = coins - v_take where id = p.player_id; end if;
  update public.runs set status = 'rejected', reject_reason = 'Refunded purchase ' || p.reference,
    updated_at = now(), finished_at = coalesce(finished_at, now())
    where id = any(v_runs) and status <> 'rejected';
  update public.purchases set status = 'refunded', resolved_at = now(), resolved_by = p_admin where id = p.id;
  insert into public.coin_ledger (player_id, delta, reason, purchase_id, admin_email, note)
    values (p.player_id, -v_take, 'refund', p.id, p_admin,
      'Refunded ' || p.reference || ': ' || v_take || ' unspent coin(s) taken back, '
      || coalesce(array_length(v_runs, 1), 0) || ' paid run(s) dropped from the boards');
  select coins into v_balance from public.players where id = p.player_id;
  return jsonb_build_object('found', true, 'refunded', true, 'removed', v_take, 'unspent', v_unspent,
    'runs', coalesce(array_length(v_runs, 1), 0), 'balance', coalesce(v_balance, 0));
end $$;

-- Starting a run, now with paid extra tries. Today's free tries for this game are counted first and spent
-- first; only once they are gone, and only if the caller allows it, is one coin spent and a paid run created.
-- The coin and the run are one transaction and the player's row is locked, so two taps with one coin left
-- give exactly one run. Existing five- and six-argument callers keep working and never spend a coin.
create or replace function public.start_run(p_player uuid, p_game text, p_day text, p_seed bigint, p_limit int, p_request uuid, p_allow_paid boolean)
returns setof public.runs
language plpgsql security definer set search_path = public as $$
declare used int; v_coins int; v_paid boolean := false; v_run public.runs;
begin
  perform pg_advisory_xact_lock(hashtext(p_player::text || ':' || p_game || ':' || p_day));
  if p_request is not null and exists(select 1 from public.runs where player_id = p_player and request_id = p_request) then
    return query select * from public.runs where player_id = p_player and request_id = p_request;
    return;
  end if;
  select count(*) into used from public.runs
    where player_id = p_player and game = p_game and day = p_day and not paid;
  if used >= p_limit then
    if not coalesce(p_allow_paid, false) then return; end if;
    select coins into v_coins from public.players where id = p_player for update;
    if coalesce(v_coins, 0) < 1 then return; end if;
    v_paid := true;
  end if;
  update public.runs set status = 'closed', finished_at = now()
    where player_id = p_player and game = p_game and status = 'open';
  if not v_paid then
    return query insert into public.runs (player_id, game, day, seed, request_id)
      values (p_player, p_game, p_day, p_seed, p_request) returning *;
    return;
  end if;
  update public.players set coins = coins - 1 where id = p_player;
  insert into public.runs (player_id, game, day, seed, request_id, paid)
    values (p_player, p_game, p_day, p_seed, p_request, true) returning * into v_run;
  insert into public.coin_ledger (player_id, delta, reason, run_id, note)
    values (p_player, -1, 'run', v_run.id, 'Extra try: ' || p_game);
  return next v_run;
end $$;

revoke all on function public.grant_purchase(uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_purchase(uuid, text) from public, anon, authenticated;
revoke all on function public.adjust_coins(uuid, int, text, text) from public, anon, authenticated;
revoke all on function public.refund_purchase(uuid, text) from public, anon, authenticated;
revoke all on function public.start_run(uuid, text, text, bigint, int, uuid, boolean) from public, anon, authenticated;
grant execute on function public.grant_purchase(uuid, text) to service_role;
grant execute on function public.cancel_purchase(uuid, text) to service_role;
grant execute on function public.adjust_coins(uuid, int, text, text) to service_role;
grant execute on function public.refund_purchase(uuid, text) to service_role;
grant execute on function public.start_run(uuid, text, text, bigint, int, uuid, boolean) to service_role;

-- Set these on Vercel (Production and Preview) before the shop can appear:
--   ARCADE_PAYMENT_PROVIDER=manual
--   ARCADE_PAY_ACCOUNT_NAME, and either ARCADE_PAY_BSB + ARCADE_PAY_ACCOUNT_NUMBER or ARCADE_PAY_PAYID
--   ARCADE_PAY_NOTE (optional one-line instruction shown under the details)
--   ARCADE_ADMIN_EMAILS (already needed for the end-of-month page)
--
--   Waiting for payment:  select reference, coins, amount_cents, created_at from public.purchases where status = 'pending' order by created_at;
--   A player's coins:     select name, coins from public.players order by coins desc;
--   One player's ledger:  select created_at, delta, reason, note, admin_email from public.coin_ledger where player_id = '...' order by created_at;
--   Refunded runs:        select * from public.runs where reject_reason like 'Refunded purchase %';

-- Reviewing runs and handing out invite codes. Everything an admin does to a run or an invite code is written
-- here with their email, so a disqualification or a new code can always be traced back to a person. Existing
-- projects get this from admin-log.sql.
create table if not exists public.admin_log (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  action text not null check (action in ('run_clear_flag','run_reject','invite_create','invite_max_uses')),
  run_id uuid references public.runs(id) on delete set null,
  invite_code text references public.invites(code) on delete set null,
  note text not null default '',
  details jsonb not null default '{}'::jsonb,   -- what changed: the score and game for a run, the uses for a code
  created_at timestamptz not null default now()
);
create index if not exists admin_log_recent on public.admin_log (created_at desc, id desc);
alter table public.admin_log enable row level security;
revoke all on public.admin_log from public, anon, authenticated;
