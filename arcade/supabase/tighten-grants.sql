-- Defence in depth: the browser keys lose every write privilege on every table in public. Run this once in
-- the Supabase SQL editor; it is idempotent, so re-running it changes nothing.
--
-- Supabase's default privileges grant a new table in `public` to `anon` and `authenticated` as it is created,
-- so every table here has arrived holding the full set — insert, update, delete, truncate, references and
-- trigger — and row-level security has been the only thing standing between a browser key and a write.
-- Nothing has come of that, because the policies that exist are all `for select` and nothing exposes a row to
-- a write. But it means a read policy added later for some other reason would be enough to let a player write
-- the table it was added to, which is what already happened once on `players` (see paid-tries.sql, where the
-- balance is cached). `month_results` and `month_prizes` are the plainest case: row-level security is on and
-- there is not one policy, so they are protected by that alone.
--
-- Afterwards the service role is the only thing that can write anything, which is how /api has always worked:
-- every write goes through it or through a `security definer` function, and neither is affected by this.
--
-- Reads are deliberately left exactly as they are. Only the six write privileges are revoked, so the three
-- policy-backed reads from paid-tries.sql — players_own_read, purchases_own_read, coin_ledger_own_read —
-- keep working untouched, and so does anything else that reads.
--
-- Order does not matter: run it before or after paid-tries.sql. It revokes a superset of what that file
-- revokes on `players`, and that file only ever grants `select`, which this leaves alone. Running
-- paid-tries.sql again afterwards cannot reopen anything.

-- Every table in public, including any added since this was written.
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
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from %s',
      t.tablename, grantees);
  end loop;
end $$;

-- And every table added after this, so a new table does not quietly arrive holding writes again. Default
-- privileges belong to the role that creates the object, so this covers whichever roles have set them here
-- (on Supabase that is the role the SQL editor runs as) rather than assuming one name.
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
    execute format('alter default privileges for role %I in schema public revoke insert, update, delete, truncate, references, trigger on tables from %s',
      r.role, grantees);
  end loop;
end $$;

--   Who can write what:   select table_name, grantee, privilege_type from information_schema.role_table_grants
--                          where table_schema = 'public' and grantee in ('anon','authenticated','PUBLIC')
--                            and privilege_type <> 'SELECT' order by 1, 2, 3;   -- expect no rows
--   What is still read:   select table_name, grantee from information_schema.role_table_grants
--                          where table_schema = 'public' and grantee in ('anon','authenticated','PUBLIC')
--                            and privilege_type = 'SELECT' order by 1, 2;
--   Defaults for new tables: select pg_get_userbyid(defaclrole), defaclacl from pg_default_acl
--                          where defaclnamespace = 'public'::regnamespace and defaclobjtype = 'r';
