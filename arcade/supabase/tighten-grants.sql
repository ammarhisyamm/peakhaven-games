-- Defence in depth: the browser keys lose every privilege on every table in public, except the three reads a
-- policy actually relies on. Run this once in the Supabase SQL editor; it is idempotent, so re-running it
-- changes nothing.
--
-- Supabase's default privileges grant a new table in `public` to `anon` and `authenticated` as it is created,
-- so every table here arrived holding the lot — select, insert, update, delete, truncate, references and
-- trigger — and row-level security has been the only thing standing between a browser key and the data.
-- Nothing has come of that: the policies that exist are all `for select`, nothing exposes a row to a write,
-- and the tables with no policy at all return nothing to anybody. But it means a policy added later for some
-- other reason is enough to open the table it was added to, which is what already happened once on `players`,
-- where the coin balance is cached. `month_results` and `month_prizes` are the plainest case: row-level
-- security is on and there is not one policy, so that is all that protects them.
--
-- Nothing in the browser reads a table directly. The only Supabase client it builds is in ui/account.js and
-- it calls four things, all of them authentication: getSession, onAuthStateChange, signInWithOtp, signOut.
-- Every game, board, wallet and admin read goes through /api with the service role, which none of this
-- touches. So the browser keys lose their reads as well as their writes.
--
-- What survives is `authenticated` select on the three tables a policy is written against — players,
-- purchases and coin_ledger — because a policy that cannot see its table does nothing. A signed-in player
-- can still read their own player row, their own purchases and their own ledger, and nothing else, which is
-- what those policies already said. `anon` keeps nothing at all.
--
-- Order against paid-tries.sql does not matter. That file grants `select` to `authenticated` on the same
-- three tables and nothing to `anon`, so the two converge whichever way round they run.

-- 1. Every table in public, including any added since this was written.
do $$
declare
  t record;
  grantees text;
begin
  -- PUBLIC always exists. anon and authenticated only exist on a real Supabase project, so naming them
  -- conditionally keeps this runnable against a plain Postgres (the verification harness, a local copy).
  select string_agg(quote_ident(rolname), ', ') into grantees
    from pg_roles where rolname in ('anon', 'authenticated');
  grantees := concat_ws(', ', 'public', grantees);
  for t in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('revoke all on public.%I from %s', t.tablename, grantees);
  end loop;
end $$;

-- 2. The three reads a policy relies on, handed back to `authenticated` and to nobody else. Each is named
--    only if it is there, so this runs on a project that has not had paid-tries.sql yet.
do $$
declare t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then return; end if;
  foreach t in array array['players', 'purchases', 'coin_ledger'] loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

-- 3. And everything added after this, so a new table does not quietly arrive readable or writable by a
--    browser key, a new sequence does not arrive usable by one, and a new function at least does not
--    arrive holding their explicit grants. A new object that genuinely needs a policy-backed read grants
--    it deliberately, as above.
--
--    Default privileges belong to the role that creates the object, and a session can only change them
--    for a role it is a member of. On Supabase there are two: the SQL editor runs as `postgres`, which
--    owns what the migrations create, and `supabase_admin` holds the platform defaults that hand a new
--    table to the browser keys. `postgres` is not a member of `supabase_admin`, so asking to change that
--    one raises 42501 and — because this whole file is one transaction — takes the rest of the migration
--    down with it. That is exactly what happened the first time this was run.
--
--    So each role is checked with pg_has_role first and skipped with a notice if it is not ours to change,
--    with a per-role exception block behind it in case the check and the server ever disagree. What the
--    skip costs is real and worth knowing: a table created later *by supabase_admin* would still arrive
--    with the platform defaults. Nothing in this project creates tables that way — migrations run as the
--    SQL editor user — and the sweep in section 1 catches anything that ever did, next time this is run.
do $$
declare
  r record;
  grantees text;
  skipped text := '';
begin
  select string_agg(quote_ident(rolname), ', ') into grantees
    from pg_roles where rolname in ('anon', 'authenticated');
  grantees := concat_ws(', ', 'public', grantees);
  for r in
    select distinct pg_get_userbyid(defaclrole)::text as role
      from pg_default_acl
     where defaclnamespace = 'public'::regnamespace and defaclobjtype in ('r', 'f', 'S')
    union
    select current_user::text
  loop
    -- A role is always a member of itself, so current_user always passes this.
    if not pg_has_role(current_user, r.role, 'MEMBER') then
      skipped := concat_ws(', ', nullif(skipped, ''), r.role);
      raise notice 'tighten-grants: not a member of %, leaving its default privileges alone', r.role;
      continue;
    end if;
    begin
      execute format('alter default privileges for role %I in schema public revoke all on tables from %s',
        r.role, grantees);
      execute format('alter default privileges for role %I in schema public revoke all on routines from %s',
        r.role, grantees);
      execute format('alter default privileges for role %I in schema public revoke all on sequences from %s',
        r.role, grantees);
    exception when insufficient_privilege then
      skipped := concat_ws(', ', nullif(skipped, ''), r.role);
      raise notice 'tighten-grants: could not change default privileges for % (%), leaving them alone',
        r.role, sqlerrm;
    end;
  end loop;
  if skipped <> '' then
    raise notice 'tighten-grants: finished. Default privileges left alone for: %. Everything else was applied.', skipped;
  end if;
end $$;

-- 4. One honest caveat about functions, since section 3 covers routines as well.
--
--    A sequence added later is owner-only unless something grants it, so removing the anon and
--    authenticated default grants is the whole job for those.
--
--    A function is different. Postgres grants EXECUTE on every new function to PUBLIC from acldefault(),
--    and ALTER DEFAULT PRIVILEGES cannot take that away: a REVOKE that would leave the default equal to
--    the built-in one stores nothing at all. Measured on PostgreSQL 15.18 across every form of the command
--    (ON FUNCTIONS and ON ROUTINES, with and without FOR ROLE, before and after a grant), the new function
--    still came out with =X/owner and anon could still call it, because every role is a member of PUBLIC.
--
--    So what the routines line buys is the removal of the explicit anon and authenticated default grants.
--    That is worth having, but it is not the guarantee. The guarantee for functions is the explicit revoke
--    each migration writes beside the function it creates:
--
--        revoke all on function public.whatever(...) from public, anon, authenticated;
--        grant execute on function public.whatever(...) to service_role;
--
--    schema.sql and paid-tries.sql already do that for all six of ours, and tools/verify-grants.mjs fails
--    if any function in public is ever left executable by PUBLIC or by a browser key, which is what keeps
--    it true.
--
--    service_role is deliberately left out of all of this. Supabase's defaults grant it routines and
--    sequences, and leaving that alone means a later migration does not have to remember to grant execute
--    to the service role for /api to call its own function.
--   What a browser key holds:  select table_name, grantee, privilege_type from information_schema.role_table_grants
--                               where table_schema = 'public' and grantee in ('anon','authenticated','PUBLIC')
--                               order by 1, 2, 3;   -- expect select on players, purchases and coin_ledger, for
--                                                   -- authenticated only, and nothing else at all
--   Defaults for new objects:  select pg_get_userbyid(defaclrole), defaclobjtype, defaclacl from pg_default_acl
--                               where defaclnamespace = 'public'::regnamespace order by 1, 2;
--                               -- 'r' tables, 'f' routines, 'S' sequences; no anon, authenticated or
--                               -- bare-PUBLIC entry should appear in any of them
