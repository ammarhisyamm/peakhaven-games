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

-- 3. And every table added after this, so a new table does not quietly arrive readable or writable by a
--    browser key. Default privileges belong to the role that creates the object, so this covers whichever
--    roles have set them here (on Supabase that is the role the SQL editor runs as) rather than assuming one
--    name. A new table that genuinely needs a policy-backed read grants it deliberately, as above.
do $$
declare
  r record;
  grantees text;
begin
  select string_agg(quote_ident(rolname), ', ') into grantees
    from pg_roles where rolname in ('anon', 'authenticated');
  grantees := concat_ws(', ', 'public', grantees);
  for r in
    select distinct pg_get_userbyid(defaclrole) as role
      from pg_default_acl
     where defaclnamespace = 'public'::regnamespace and defaclobjtype = 'r'
    union
    select current_user::text
  loop
    execute format('alter default privileges for role %I in schema public revoke all on tables from %s',
      r.role, grantees);
  end loop;
end $$;

--   What a browser key holds:  select table_name, grantee, privilege_type from information_schema.role_table_grants
--                               where table_schema = 'public' and grantee in ('anon','authenticated','PUBLIC')
--                               order by 1, 2, 3;   -- expect select on players, purchases and coin_ledger, for
--                                                   -- authenticated only, and nothing else at all
--   Defaults for new tables:   select pg_get_userbyid(defaclrole), defaclacl from pg_default_acl
--                               where defaclnamespace = 'public'::regnamespace and defaclobjtype = 'r';
