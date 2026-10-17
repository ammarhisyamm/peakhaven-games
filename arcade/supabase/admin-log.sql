-- Reviewing runs and handing out invite codes. Run this once in the Supabase SQL editor to upgrade an existing
-- project; it is idempotent, so re-running it changes nothing. New projects get all of it from schema.sql.
--
-- Everything an admin does to a run or an invite code is written here with their email, so a disqualification
-- or a new code can always be traced back to a person. It is one table and nothing else: clearing a flag and
-- rejecting a run are ordinary updates to public.runs, and the invite changes are ordinary updates to
-- public.invites, both of which already exist.
--
-- Until this has run, the admin page still lists flagged and rejected runs and the invite codes, but the
-- buttons are turned off and say why. An action that cannot be logged is not worth doing, so the server
-- refuses it rather than making a change nobody can trace.

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
-- The admin page shows the most recent actions first.
create index if not exists admin_log_recent on public.admin_log (created_at desc, id desc);

alter table public.admin_log enable row level security;

-- Nothing here is ever read by a browser. The admin page reads it through /api with the service role, the same
-- way it reads the coin ledger, so no policy exposes a row and no browser key holds a grant on it.
revoke all on public.admin_log from public, anon, authenticated;

--   Recent admin actions:  select created_at, admin_email, action, note from public.admin_log order by created_at desc limit 50;
--   Everything on one run: select * from public.admin_log where run_id = '...' order by created_at;
--   Who made a code:       select created_at, admin_email, note from public.admin_log where invite_code = 'PEAK-FRIENDS';
