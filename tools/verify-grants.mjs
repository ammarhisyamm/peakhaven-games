// Proves arcade/supabase/tighten-grants.sql against a real, throwaway Postgres before it is ever run in
// production: that it applies on top of the live schema in either order, that a second run changes nothing,
// that no browser key is left holding a write on any table, that the reads a policy relies on still work, and
// that every service-role path the server uses is untouched.
//
//   npm i --no-save pg embedded-postgres@15.18.0-beta.17
//   node tools/verify-grants.mjs
//
// It never touches a live database. By default it starts its own Postgres in a temporary directory and throws
// it away afterwards. Point PGURL at a database you do not mind losing to use that instead.
//
//   PGURL=postgres://...          use this database rather than starting one (it is dropped and rebuilt)
//   VERIFY_SQL_MODULES=<dir>      where to find pg and embedded-postgres, if they are not installed here
//   VERIFY_SQL_PORT=54330         port for the Postgres it starts
//   VERIFY_SQL_KEEP=1             leave the database running afterwards, to poke at it
//   VERIFY_GRANTS_TABLE=1         print the full before/after grant table
//
// What it builds first is a stand-in for the live project: Supabase's three roles, its default privileges on
// the public schema — which is the whole reason this migration exists, because they are what hands a new
// table to the browser keys — an auth.users table and an auth.uid() that reads a session setting. Then the
// production schema and the migrations as they stand in this working tree.
import {createRequire} from 'node:module';
import {readFile, rm, mkdtemp} from 'node:fs/promises';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.VERIFY_SQL_PORT || 54330);

// pg and embedded-postgres are not dependencies of this repo: the tests run on node alone. Install them with
// --no-save when you need this, or point VERIFY_SQL_MODULES at somewhere that has them.
const require = createRequire(process.env.VERIFY_SQL_MODULES ? join(resolve(process.env.VERIFY_SQL_MODULES), 'index.cjs') : import.meta.url);
function load(name) {
  try {return require.resolve(name);}
  catch {throw new Error(`${name} is not installed. Run: npm i --no-save pg embedded-postgres@15.18.0-beta.17   (or set VERIFY_SQL_MODULES)`);}
}
const pg = require(load('pg'));

let failures = 0, checks = 0;
const check = (label, pass, detail = '') => {
  checks++;
  if (!pass) failures++;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
};
const section = title => console.log(`\n== ${title}`);
const sql = name => readFile(join(root, 'arcade/supabase', name), 'utf8');

const WRITES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const BROWSER_ROLES = ['anon', 'authenticated', 'PUBLIC'];
// The only grants that may survive: the reads the three policies are written against, for signed-in players
// alone. A policy that cannot see its table does nothing, so these have to stay.
const KEPT = [['coin_ledger', 'authenticated'], ['players', 'authenticated'], ['purchases', 'authenticated']];
const keptKey = rows => rows.map(r => `${r.table_name}:${r.grantee}:${r.privilege_type}`).sort().join(' ');
const KEPT_KEY = KEPT.map(([table, role]) => `${table}:${role}:SELECT`).sort().join(' ');

// Supabase's own scaffolding, as far as a migration can see it: the roles, the default privileges that make a
// new public table writable by the browser's keys, and the auth schema the players table points at.
const SUPABASE_BASELINE = `
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on routines to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

async function startPostgres() {
  if (process.env.PGURL) return {url: process.env.PGURL, stop: async () => {}, label: 'PGURL'};
  const EmbeddedPostgres = (await import(pathToFileURL(load('embedded-postgres')).href)).default;
  const dir = await mkdtemp(join(tmpdir(), 'ph-verify-grants-'));
  const db = new EmbeddedPostgres({databaseDir: join(dir, 'pgdata'), user: 'postgres', password: 'postgres', port: PORT, persistent: false});
  await db.initialise();
  await db.start();
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`,
    label: `embedded-postgres in ${dir}`,
    async stop() {
      if (process.env.VERIFY_SQL_KEEP) return console.log(`\nLeft running on port ${PORT}; data in ${dir}`);
      await db.stop();
      await rm(dir, {recursive: true, force: true});
    },
  };
}

// A fresh database built from a list of migration files, in the order given.
async function build(adminUrl, name, files) {
  const admin = new pg.Client({connectionString: adminUrl});
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const db = new pg.Client({connectionString: adminUrl.replace(/\/[^/]*$/, `/${name}`)});
  // A query that is refused mid-flight must not take the process down before the finally below runs.
  db.on('error', () => {});
  await db.connect();
  await db.query(SUPABASE_BASELINE);
  for (const file of files) await db.query(await sql(file));
  return db;
}

// Everything about the schema that a second run of this migration could change. Grants are the point of it,
// so they are in here twice over: on tables and on functions.
const FINGERPRINT = `
select json_build_object(
  'columns', (select json_agg(x) from (select table_name, column_name, data_type, is_nullable, column_default
     from information_schema.columns where table_schema = 'public' order by table_name, column_name) x),
  'policies', (select json_agg(x) from (select tablename, policyname, cmd, roles::text, qual
     from pg_policies where schemaname = 'public' order by 1, 2) x),
  'functions', (select json_agg(x) from (select p.proname, pg_get_function_identity_arguments(p.oid) as args, md5(p.prosrc) as body
     from pg_proc p where pronamespace = 'public'::regnamespace order by 1, 2) x),
  'table_grants', (select json_agg(x) from (select table_name, grantee, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon','authenticated','service_role','PUBLIC') order by 1, 2, 3) x),
  'function_grants', (select json_agg(x) from (select p.proname, a.grantee, a.privilege_type
     from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e,
          lateral (select pg_get_userbyid(e.grantee) as grantee, e.privilege_type) a
     where p.pronamespace = 'public'::regnamespace order by 1, 2, 3) x),
  'default_acl', (select json_agg(x) from (select pg_get_userbyid(defaclrole) as role, defaclobjtype, defaclacl::text
     from pg_default_acl where defaclnamespace = 'public'::regnamespace order by 1, 2) x)
) as fingerprint`;

// Any function in public that a browser key could call. PUBLIC is grantee oid 0, and pg_get_userbyid(0)
// does not return 'public', so comparing on the name would miss the very case this exists to catch.
// Extension-owned functions are left out: on Supabase pgcrypto lives in the extensions schema, and in this
// stand-in it lands in public, which is the harness's doing rather than the project's.
const OPEN_FUNCTIONS = `select p.proname,
    case when e.grantee = 0 then 'PUBLIC' else pg_get_userbyid(e.grantee) end as grantee
  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
  where p.pronamespace = 'public'::regnamespace
    and p.prokind = 'f'
    and e.privilege_type = 'EXECUTE'
    and (e.grantee = 0 or pg_get_userbyid(e.grantee) in ('anon', 'authenticated'))
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  order by 1, 2`;

const GRANTS = `select table_name, grantee, privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and grantee = any($1) order by table_name, grantee, privilege_type`;

const grantsOf = async (db, roles = BROWSER_ROLES) => (await db.query(GRANTS, [roles])).rows;
const writesOf = rows => rows.filter(r => WRITES.includes(r.privilege_type));
// "players: anon INSERT/UPDATE, authenticated INSERT/UPDATE" — how the report reads it.
function summarise(rows) {
  const byTable = new Map();
  for (const r of rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, new Map());
    const roles = byTable.get(r.table_name);
    if (!roles.has(r.grantee)) roles.set(r.grantee, []);
    roles.get(r.grantee).push(r.privilege_type);
  }
  return [...byTable.entries()].map(([table, roles]) =>
    `    ${table.padEnd(16)} ${[...roles.entries()].map(([role, privs]) => `${role}: ${privs.join(',')}`).join('  |  ')}`).join('\n');
}

const uuid = () => crypto.randomUUID();
async function newPlayer(db, name) {
  const id = uuid();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@verify.test`]);
  await db.query('insert into public.players (id, name, bottle) values ($1, $2, $3)', [id, name, 'ph-original']);
  return id;
}
// As a signed-in browser would arrive: the role PostgREST switches to, and the player the JWT names.
async function asRole(db, role, playerId = null) {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [playerId ?? '']);
  await db.query(`set role ${role}`);
}
const asOwner = db => db.query('reset role');
async function refused(promise) {
  try {await promise; return null;}
  catch (error) {return error.code || error.message;}
}

const LIVE = ['schema.sql', 'month-end.sql', 'paid-tries.sql', 'achievements.sql'];
const DAY = '2026-10-17';

const server = await startPostgres();
console.log(`Postgres: ${server.label}`);
try {
  // ---------------------------------------------------------------- before, and what it takes away
  section('Before: what the browser keys hold on the live schema');
  const before = await build(server.url, 'ph_before', LIVE);
  const beforeGrants = await grantsOf(before);
  const beforeWrites = writesOf(beforeGrants);
  console.log(summarise(beforeWrites) || '    (none)');
  check('the browser keys hold writes on the live schema, which is what this is for', beforeWrites.length > 0,
    `${beforeWrites.length} write grants`);
  const tables = [...new Set((await before.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`)).rows.map(r => r.tablename))];
  check('every table is covered by the sweep', tables.length >= 7, tables.join(', '));

  // ---------------------------------------------------------------- it applies, and applies twice
  section('The migration applies on top of the live schema, and applies twice');
  const db = await build(server.url, 'ph_tight', [...LIVE, 'tighten-grants.sql']);
  check('it applies', true);
  const once = (await db.query(FINGERPRINT)).rows[0].fingerprint;
  await db.query(await sql('tighten-grants.sql'));
  const twice = (await db.query(FINGERPRINT)).rows[0].fingerprint;
  check('a second run changes nothing at all', JSON.stringify(once) === JSON.stringify(twice));

  section('After: what the browser keys hold now');
  const afterGrants = await grantsOf(db);
  console.log(summarise(afterGrants) || '    (nothing at all)');
  check('no browser key holds a write on any table in public', writesOf(afterGrants).length === 0,
    JSON.stringify(writesOf(afterGrants)));
  check('anon holds nothing whatsoever, on any table',
    afterGrants.filter(r => r.grantee === 'anon').length === 0,
    JSON.stringify(afterGrants.filter(r => r.grantee === 'anon')));
  check('PUBLIC holds nothing whatsoever either',
    afterGrants.filter(r => r.grantee === 'PUBLIC').length === 0,
    JSON.stringify(afterGrants.filter(r => r.grantee === 'PUBLIC')));
  check('and all that is left is select on the three tables a policy is written against',
    keptKey(afterGrants) === KEPT_KEY, keptKey(afterGrants) || '(nothing)');
  for (const table of ['invites', 'runs', 'month_results', 'month_prizes']) {
    check(`authenticated lost its read on ${table}, which no policy ever mentioned`,
      !afterGrants.some(r => r.table_name === table && r.grantee === 'authenticated'));
  }
  const serviceBefore = await grantsOf(before, ['service_role']);
  const serviceAfter = await grantsOf(db, ['service_role']);
  check('the service role is untouched', JSON.stringify(serviceBefore) === JSON.stringify(serviceAfter),
    `${serviceAfter.length} grants`);

  // ---------------------------------------------------------------- a browser key, table by table
  section('What a browser key can do now, on every table');
  const player = await newPlayer(db, 'Mina');
  for (const role of ['anon', 'authenticated']) {
    const codes = [];
    for (const table of tables) {
      await asRole(db, role, player);
      codes.push(await refused(db.query(`delete from public.${table}`)));
    }
    await asOwner(db);
    check(`${role} cannot delete from any of the ${tables.length} tables`,
      codes.every(c => c === '42501'), [...new Set(codes)].join(','));
  }
  await asRole(db, 'authenticated', player);
  const writeCodes = {
    'insert a player': await refused(db.query('insert into public.players (id, name) values ($1, $2)', [uuid(), 'Ghost'])),
    'give themselves coins': await refused(db.query('update public.players set coins = 999 where id = $1', [player])),
    'un-reject a run': await refused(db.query(`update public.runs set status = 'closed'`)),
    'write a month result': await refused(db.query(`insert into public.month_results (month, game, player_id, rank, score)
      values ('2026-09', 'ridge', $1, 1, 9999)`, [player])),
    'rewrite a prize': await refused(db.query(`update public.month_prizes set text = 'mine'`)),
    'mint an invite code': await refused(db.query(`insert into public.invites (code, max_uses) values ('FREE', 999)`)),
    'truncate the ledger': await refused(db.query('truncate public.coin_ledger')),
  };
  await asOwner(db);
  for (const [what, code] of Object.entries(writeCodes)) {
    check(`a signed-in player cannot ${what}`, code === '42501', `code ${code}`);
  }
  check('and the balance is still zero after all of that',
    Number((await db.query('select coins from public.players where id = $1', [player])).rows[0].coins) === 0);

  // ---------------------------------------------------------------- the reads a policy relies on
  section('The reads a policy relies on still work');
  await asOwner(db);
  const purchase = (await db.query(
    `insert into public.purchases (player_id, pack, coins, amount_cents, currency, reference, provider)
     values ($1, 5, 5, 999, 'AUD', 'PHA-READ', 'manual') returning *`, [player])).rows[0];
  await db.query('select public.grant_purchase($1, $2)', [purchase.id, 'boss@verify.test']);
  const other = await newPlayer(db, 'Other');

  await asRole(db, 'authenticated', player);
  check('players_own_read: a player still reads their own row',
    (await db.query('select coins from public.players where id = $1', [player])).rows.length === 1);
  check('purchases_own_read: and their own purchases',
    (await db.query('select reference from public.purchases')).rows.length === 1);
  check('coin_ledger_own_read: and their own ledger',
    (await db.query('select delta from public.coin_ledger')).rows.length > 0);
  await asRole(db, 'authenticated', other);
  check('and still cannot read somebody else\'s purchases',
    (await db.query('select reference from public.purchases')).rows.length === 0);
  // A logged-out visitor is now refused every table outright, rather than reading an empty result from one.
  const anonReads = [];
  for (const table of tables) {
    await asRole(db, 'anon');
    anonReads.push(await refused(db.query(`select * from public.${table} limit 1`)));
  }
  await asOwner(db);
  check(`an anonymous key is refused a read of all ${tables.length} tables`,
    anonReads.every(c => c === '42501'), [...new Set(anonReads)].join(','));

  // A signed-in player keeps exactly the three reads, and sees only their own rows in each.
  await asRole(db, 'authenticated', player);
  check('a signed-in player still reads their own player row',
    (await db.query('select coins from public.players where id = $1', [player])).rows.length === 1);
  check('and cannot see anybody else in players',
    (await db.query('select id from public.players')).rows.length === 1);
  const playerReads = [];
  for (const table of tables.filter(t => !['players', 'purchases', 'coin_ledger'].includes(t))) {
    await asRole(db, 'authenticated', player);
    playerReads.push([table, await refused(db.query(`select * from public.${table} limit 1`))]);
  }
  await asOwner(db);
  check('and is refused every table no policy covers',
    playerReads.every(([, code]) => code === '42501'), JSON.stringify(playerReads));
  await asOwner(db);

  // ---------------------------------------------------------------- the server's own paths
  section('Every service-role path the server uses still works');
  await db.query(`insert into public.invites (code, max_uses) values ('HARNESS', 5) on conflict do nothing`);
  await asRole(db, 'service_role');
  check('use_invite still takes a code', (await db.query(`select public.use_invite('HARNESS')`)).rows[0].use_invite === true);
  const freeRun = (await db.query('select * from public.start_run($1, $2, $3, $4, $5, $6, $7)',
    [player, 'ridge', DAY, 12345, 3, uuid(), false])).rows[0];
  check('start_run still starts a free run', Boolean(freeRun?.id) && freeRun.paid === false);
  await db.query(`update public.runs set score = 500, status = 'closed', segments = 1, updated_at = now() where id = $1`, [freeRun.id]);
  check('the service role can still finish a run, as /api/finish does',
    Number((await db.query('select score from public.runs where id = $1', [freeRun.id])).rows[0].score) === 500);
  // Three free tries gone, then a coin.
  for (let i = 0; i < 2; i++) await db.query('select * from public.start_run($1, $2, $3, $4, $5, $6, $7)', [player, 'ridge', DAY, 1, 3, uuid(), false]);
  const paidRun = (await db.query('select * from public.start_run($1, $2, $3, $4, $5, $6, $7)',
    [player, 'ridge', DAY, 999, 3, uuid(), true])).rows[0];
  check('start_run still spends a coin for an extra try', paidRun?.paid === true);
  const adjusted = (await db.query('select public.adjust_coins($1, $2, $3, $4) as r', [player, 3, 'harness', 'boss@verify.test'])).rows[0].r;
  check('adjust_coins still moves a balance', adjusted.found === true && Number(adjusted.balance) > 0);
  const second = (await db.query(
    `insert into public.purchases (player_id, pack, coins, amount_cents, currency, reference, provider)
     values ($1, 1, 1, 299, 'AUD', 'PHA-SVC', 'manual') returning *`, [player])).rows[0];
  const granted = (await db.query('select public.grant_purchase($1, $2) as r', [second.id, 'boss@verify.test'])).rows[0].r;
  check('grant_purchase still grants, once', granted.granted === true);
  const refunded = (await db.query('select public.refund_purchase($1, $2) as r', [second.id, 'boss@verify.test'])).rows[0].r;
  check('refund_purchase still refunds', refunded.refunded === true);
  const cancelled = (await db.query('select public.cancel_purchase($1, $2) as r', [purchase.id, 'boss@verify.test'])).rows[0].r;
  check('cancel_purchase still answers', cancelled.found === true);
  await asOwner(db);

  // ---------------------------------------------------------------- tables made later
  section('A table made after the migration does not arrive holding writes');
  await db.query('create table public.something_new (id uuid primary key default gen_random_uuid(), note text)');
  const newGrants = writesOf(await grantsOf(db));
  check('default privileges no longer hand a new table to the browser keys', newGrants.length === 0,
    newGrants.length ? JSON.stringify(newGrants) : '');
  await asRole(db, 'authenticated', player);
  check('and a signed-in player cannot write to it',
    (await refused(db.query(`insert into public.something_new (note) values ('x')`))) === '42501');
  await asOwner(db);
  await db.query('drop table public.something_new');

  // ---------------------------------------------------------------- the other order
  section('What the default privileges can and cannot do for a later function');
  // Sequences and functions behave differently here, and the difference matters.
  //
  // A new sequence is owner-only by default, so taking the anon and authenticated default grants away is
  // the whole job: nothing else grants them.
  //
  // A new function is not. Postgres grants EXECUTE on it to PUBLIC itself, from acldefault(), and ALTER
  // DEFAULT PRIVILEGES cannot take that away: a REVOKE that would leave the default equal to the built-in
  // one stores nothing at all. Measured here on 15.18 across every form of the command. Every role is a
  // member of PUBLIC, so a function added later is callable by a browser key until its own migration
  // revokes it. The protection for functions is that explicit revoke, and the section after this one is
  // what enforces it.
  const DOLLAR = String.fromCharCode(36);
  await db.query('create sequence public.something_counting');
  await db.query('create function public.something_later(n int) returns int language sql immutable as ' + DOLLAR + 'fn' + DOLLAR + ' select n * 2 ' + DOLLAR + 'fn' + DOLLAR + '');

  for (const role of ['anon', 'authenticated']) {
    await asRole(db, role, player);
    check(`${role} cannot use a sequence added later`,
      (await refused(db.query("select nextval('public.something_counting')"))) === '42501');
    await asOwner(db);
  }
  const seqDefaults = (await db.query(`select defaclacl::text as acl from pg_default_acl
    where defaclnamespace = 'public'::regnamespace and defaclobjtype = 'S'`)).rows.map(r => r.acl).join(' ');
  check('and the sequence defaults name no browser role at all',
    !/\banon\b|\bauthenticated\b/.test(seqDefaults), seqDefaults || '(no row)');

  // The measured truth about functions, asserted rather than assumed, so this stops being true out loud
  // the day Postgres changes it.
  await asRole(db, 'anon', player);
  const anonCanCall = (await refused(db.query('select public.something_later(21)'))) === null;
  await asOwner(db);
  check('a function added later is still callable by anon until its migration revokes PUBLIC',
    anonCanCall, 'which is why the explicit revoke is the thing that protects it');
  // And the query that enforces this, proved against a function that really is open, so a green run of the
  // next section cannot be green because the query is looking in the wrong place.
  const flagged = (await db.query(OPEN_FUNCTIONS)).rows.map(r => `${r.proname}:${r.grantee}`);
  check('the enforcement query flags a function that is open to PUBLIC',
    flagged.some(f => f.startsWith('something_later:')), flagged.join(' ') || '(nothing flagged)');

  await db.query('revoke all on function public.something_later(int) from public, anon, authenticated');
  for (const role of ['anon', 'authenticated']) {
    await asRole(db, role, player);
    check(`${role} cannot execute it once its migration revokes PUBLIC`,
      (await refused(db.query('select public.something_later(21)'))) === '42501');
    await asOwner(db);
  }
  // service_role keeps its own default grant, so a later migration need not remember to grant it.
  await asRole(db, 'service_role');
  check('the service role can still execute it, with no grant written for it',
    Number((await db.query('select public.something_later(21) as n')).rows[0].n) === 42);
  check('and can still use a sequence added later',
    Number((await db.query("select nextval('public.something_counting') as n")).rows[0].n) === 1);
  await asOwner(db);
  await db.query('drop function public.something_later(int)');
  await db.query('drop sequence public.something_counting');

  section('Every function in public has PUBLIC revoked — the check that keeps it that way');
  // The real guarantee. If a migration ever adds a function and forgets its revoke, this fails.
  const loose = (await db.query(OPEN_FUNCTIONS)).rows;
  check('no function in public is executable by a browser key or by PUBLIC', loose.length === 0,
    loose.length ? JSON.stringify(loose) : '');
  const ours = (await db.query(`select distinct p.proname from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('grant_purchase','cancel_purchase','adjust_coins','refund_purchase','start_run','use_invite')
    order by 1`)).rows.map(r => r.proname);
  check('and the functions the server calls are all there to have been checked', ours.length === 6, ours.join(','));

  section('Run by a role that is not a member of the platform default-privilege owner');
  // This is the shape of the first live run, which failed. On Supabase the SQL editor runs as postgres,
  // and the default privileges that hand a new table to the browser keys belong to supabase_admin.
  // postgres is not a member of it, so ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin raises 42501, and
  // because the file is one transaction the whole migration rolled back and nothing was applied.
  const platform = await build(server.url, 'ph_platform', LIVE);
  const notices = [];
  platform.on('notice', n => notices.push(String(n.message || '')));
  // A platform role with its own default ACL in public, which the migrating role cannot touch.
  await platform.query(`do $BODY$ begin
    if not exists (select 1 from pg_roles where rolname = 'platform_admin') then
      create role platform_admin nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'editor') then
      create role editor nologin noinherit;
    end if;
  end $BODY$;`);
  await platform.query('grant usage, create on schema public to editor');
  await platform.query('alter default privileges for role platform_admin in schema public'
    + ' grant all on tables to anon, authenticated');
  // The migrating role owns what the migrations created, as postgres does on Supabase, and has default
  // privileges of its own so there is something it can tighten.
  const owned = (await platform.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`)).rows.map(r => r.tablename);
  for (const table of owned) await platform.query(`alter table public.${table} owner to editor`);
  await platform.query('set role editor');
  await platform.query('alter default privileges in schema public grant all on tables to anon, authenticated');
  await platform.query('reset role');

  const defaclFor = async role => (await platform.query(
    `select coalesce(string_agg(defaclacl::text, ' '), '') as acl from pg_default_acl d
      join pg_roles r on r.oid = d.defaclrole
     where d.defaclnamespace = 'public'::regnamespace and r.rolname = $1`, [role])).rows[0].acl;
  const platformBefore = await defaclFor('platform_admin');

  // Now run it exactly as the SQL editor would: as that role, in one transaction.
  await platform.query('set role editor');
  let failure = null;
  try {
    await platform.query('begin');
    await platform.query(await sql('tighten-grants.sql'));
    await platform.query('commit');
  } catch (error) {
    failure = error.code ? `${error.code}: ${error.message}` : String(error.message);
    await platform.query('rollback').catch(() => {});
  }
  await platform.query('reset role');
  check('the migration completes when a platform role owns default privileges it cannot change',
    failure === null, failure || '');
  check('and it names the role it left alone',
    notices.some(n => /platform_admin/.test(n)), notices.join(' ~ ') || '(no notices)');

  // Skipped, not silently mangled.
  check('the platform default privileges are untouched',
    (await defaclFor('platform_admin')) === platformBefore, await defaclFor('platform_admin'));
  // And the role it could act for was tightened.
  const editorAcl = await defaclFor('editor');
  check('the default privileges of the migrating role were tightened',
    !/\banon\b|\bauthenticated\b/.test(editorAcl), editorAcl || '(no row)');

  // The part that must never be skipped: the sweep over objects that already exist.
  const leftovers = writesOf(await grantsOf(platform));
  check('every existing table was still swept, in full', leftovers.length === 0,
    leftovers.length ? JSON.stringify(leftovers) : '');
  check('and only the three policy-backed reads survive, as in the clean run',
    keptKey(await grantsOf(platform)) === KEPT_KEY, keptKey(await grantsOf(platform)));

  // Idempotent in this shape too.
  const firstPrint = (await platform.query(FINGERPRINT)).rows[0].fingerprint;
  await platform.query('set role editor');
  await platform.query(await sql('tighten-grants.sql'));
  await platform.query('reset role');
  const secondPrint = (await platform.query(FINGERPRINT)).rows[0].fingerprint;
  check('and running it again changes nothing at all',
    JSON.stringify(firstPrint) === JSON.stringify(secondPrint));
  await platform.end();

  section('The other order: tighten first, then the later migrations on top');
  const reversed = await build(server.url, 'ph_reversed',
    ['schema.sql', 'month-end.sql', 'tighten-grants.sql', 'paid-tries.sql', 'achievements.sql']);
  const reversedGrants = await grantsOf(reversed);
  check('a migration running after tighten-grants cannot reopen anything', writesOf(reversedGrants).length === 0,
    JSON.stringify(writesOf(reversedGrants)));
  check('and the two orders agree on exactly which reads survive',
    keptKey(reversedGrants) === KEPT_KEY, keptKey(reversedGrants) || '(nothing)');
  check('anon holds nothing in that order either',
    reversedGrants.filter(r => r.grantee === 'anon').length === 0);
  const reversedPlayer = await newPlayer(reversed, 'Rev');
  await asRole(reversed, 'authenticated', reversedPlayer);
  check('a player still cannot write in that order either',
    (await refused(reversed.query('update public.players set coins = 50 where id = $1', [reversedPlayer]))) === '42501');
  await asRole(reversed, 'authenticated', reversedPlayer);
  check('and still reads their own row', (await reversed.query('select coins from public.players where id = $1', [reversedPlayer])).rows.length === 1);
  await asOwner(reversed);
  await asRole(reversed, 'service_role');
  check('and the service role still starts a run in that order',
    Boolean((await reversed.query('select * from public.start_run($1, $2, $3, $4, $5, $6, $7)',
      [reversedPlayer, 'blocks', DAY, 7, 3, uuid(), false])).rows[0]?.id));
  await asOwner(reversed);

  // Both orders should land on the same grants.
  const tightGrants = await grantsOf(db, ['anon', 'authenticated', 'PUBLIC', 'service_role']);
  const revGrants = await grantsOf(reversed, ['anon', 'authenticated', 'PUBLIC', 'service_role']);
  check('both orders end with exactly the same grants',
    JSON.stringify(tightGrants.filter(r => r.table_name !== 'something_new')) === JSON.stringify(revGrants));

  await before.end(); await db.end(); await reversed.end();
} finally {
  await server.stop();
}

console.log(`\n${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
