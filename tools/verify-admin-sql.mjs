// Proves the two migrations this branch adds against a real, throwaway Postgres before either is ever run in
// production: arcade/supabase/admin-log.sql and arcade/supabase/flag-details.sql.
//
//   npm i --no-save pg embedded-postgres@15.18.0-beta.17
//   node tools/verify-admin-sql.mjs
//
// It never touches a live database. By default it starts its own Postgres in a temporary directory and throws
// it away afterwards. Point PGURL at a database you do not mind losing to use that instead.
//
//   PGURL=postgres://...          use this database rather than starting one (it is dropped and rebuilt)
//   VERIFY_SQL_MODULES=<dir>      where to find pg and embedded-postgres, if they are not installed here
//   VERIFY_SQL_PORT=54331         port for the Postgres it starts
//   VERIFY_SQL_KEEP=1             leave the database running afterwards, to poke at it
//
// The base it builds is the project as production actually has it — Supabase's three roles and default
// privileges, an auth schema, and the schema and migrations as they stand on origin/main — and only then the
// two files under test, which is the same order a deployment will run them in.
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFile, rm, mkdtemp} from 'node:fs/promises';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.VERIFY_SQL_PORT || 54331);

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
// The deployed base comes from origin/main; the files under test come from this working tree.
const live = path => execFileSync('git', ['show', `origin/main:${path}`], {cwd: root, encoding: 'utf8', maxBuffer: 1 << 24});
const here = name => readFile(join(root, 'arcade/supabase', name), 'utf8');

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
  const dir = await mkdtemp(join(tmpdir(), 'ph-verify-admin-'));
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

// Production as it stands, plus whichever of the two migrations are named, in that order.
async function build(adminUrl, name, migrations = []) {
  const admin = new pg.Client({connectionString: adminUrl});
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const db = new pg.Client({connectionString: adminUrl.replace(/\/[^/]*$/, `/${name}`)});
  db.on('error', () => {});
  await db.connect();
  await db.query(SUPABASE_BASELINE);
  await db.query(live('arcade/supabase/schema.sql'));
  await db.query(live('arcade/supabase/month-end.sql'));
  await db.query(live('arcade/supabase/paid-tries.sql'));
  for (const file of migrations) await db.query(await here(file));
  return db;
}

// Everything either migration could change if it were run twice.
const FINGERPRINT = `
select json_build_object(
  'columns', (select json_agg(x) from (select table_name, column_name, data_type, is_nullable, column_default
     from information_schema.columns where table_schema = 'public' order by table_name, column_name) x),
  'constraints', (select json_agg(x) from (select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
     from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2) x),
  'indexes', (select json_agg(x) from (select tablename, indexname, indexdef from pg_indexes
     where schemaname = 'public' order by 1, 2) x),
  'policies', (select json_agg(x) from (select tablename, policyname, cmd from pg_policies
     where schemaname = 'public' order by 1, 2) x),
  'grants', (select json_agg(x) from (select table_name, grantee, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon','authenticated','service_role','PUBLIC') order by 1, 2, 3) x)
) as fingerprint`;

const column = async (db, table, name) => (await db.query(
  `select data_type, is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = $1 and column_name = $2`, [table, name])).rows[0] ?? null;
const asRole = async (db, role) => {await db.query('reset role'); await db.query(`set role ${role}`);};
const asOwner = db => db.query('reset role');
async function refused(promise) {
  try {await promise; return null;}
  catch (error) {return error.code || error.message;}
}

const server = await startPostgres();
console.log(`Postgres: ${server.label}`);
try {
  section('The base is production as it stands, without either migration');
  const base = await build(server.url, 'ph_base');
  check('admin_log is not there yet', (await base.query(
    `select to_regclass('public.admin_log') is null as missing`)).rows[0].missing);
  check('runs has neither flag-detail column yet',
    !(await column(base, 'runs', 'claimed_score')) && !(await column(base, 'runs', 'verified_score')));

  section('Both migrations apply on top of it, and each applies twice');
  const db = await build(server.url, 'ph_admin', ['admin-log.sql', 'flag-details.sql']);
  check('they apply', true);
  const once = (await db.query(FINGERPRINT)).rows[0].fingerprint;
  await db.query(await here('admin-log.sql'));
  await db.query(await here('flag-details.sql'));
  const twice = (await db.query(FINGERPRINT)).rows[0].fingerprint;
  check('running both a second time changes nothing at all', JSON.stringify(once) === JSON.stringify(twice));

  section('What admin-log.sql added');
  check('admin_log is there', (await db.query(`select to_regclass('public.admin_log') is not null as there`)).rows[0].there);
  const logCols = (await db.query(
    `select column_name from information_schema.columns where table_schema='public' and table_name='admin_log' order by 1`
  )).rows.map(r => r.column_name);
  check('with the columns the server writes',
    ['action','admin_email','created_at','details','id','invite_code','note','run_id'].every(c => logCols.includes(c)),
    logCols.join(','));
  check('row-level security is on', (await db.query(
    `select relrowsecurity from pg_class where oid = 'public.admin_log'::regclass`)).rows[0].relrowsecurity);
  const logGrants = (await db.query(
    `select grantee, privilege_type from information_schema.role_table_grants
      where table_schema='public' and table_name='admin_log' and grantee in ('anon','authenticated','PUBLIC')`)).rows;
  check('and no browser key holds anything on it at all', logGrants.length === 0,
    logGrants.length ? JSON.stringify(logGrants) : '');
  // The action names the server actually writes must all be allowed by the check constraint.
  for (const action of ['run_clear_flag', 'run_reject', 'invite_create', 'invite_max_uses']) {
    const code = await refused(db.query(
      `insert into public.admin_log (admin_email, action, note) values ('boss@verify.test', $1, 'harness')`, [action]));
    check(`the constraint accepts ${action}`, code === null, code ?? '');
  }
  check('and refuses an action nobody writes', (await refused(db.query(
    `insert into public.admin_log (admin_email, action) values ('boss@verify.test', 'nonsense')`))) === '23514');

  section('What flag-details.sql added');
  const claimed = await column(db, 'runs', 'claimed_score'), verified = await column(db, 'runs', 'verified_score');
  check('runs.claimed_score is a nullable integer', claimed?.data_type === 'integer' && claimed?.is_nullable === 'YES',
    JSON.stringify(claimed));
  check('runs.verified_score is a nullable integer', verified?.data_type === 'integer' && verified?.is_nullable === 'YES',
    JSON.stringify(verified));
  // Adding them must not have disturbed a single existing run.
  const user = (await db.query(`insert into auth.users (email) values ('mina@verify.test') returning id`)).rows[0].id;
  await db.query(`insert into public.players (id, name) values ($1, 'Mina')`, [user]);
  const run = (await db.query(
    `insert into public.runs (player_id, game, day, seed, score, status)
     values ($1, 'ridge', '2026-10-17', 1, 500, 'closed') returning *`, [user])).rows[0];
  check('an existing run reads back with both null', run.claimed_score === null && run.verified_score === null);
  await db.query(`update public.runs set claimed_score = 12400, verified_score = 9850 where id = $1`, [run.id]);
  const scored = (await db.query(`select claimed_score, verified_score from public.runs where id = $1`, [run.id])).rows[0];
  check('and the pair the server writes comes back', Number(scored.claimed_score) === 12400 && Number(scored.verified_score) === 9850);

  section('Neither browser key can touch any of it');
  for (const role of ['anon', 'authenticated']) {
    await asRole(db, role);
    check(`${role} cannot read the admin log`,
      (await refused(db.query('select * from public.admin_log'))) === '42501');
    check(`${role} cannot write the admin log`,
      (await refused(db.query(`insert into public.admin_log (admin_email, action) values ('x', 'run_reject')`))) === '42501');
    await asOwner(db);
  }
  await asRole(db, 'service_role');
  check('the service role still writes the log, which is how /api does it',
    (await refused(db.query(
      `insert into public.admin_log (admin_email, action, note) values ('boss@verify.test', 'run_reject', 'as the server')`))) === null);
  await asOwner(db);

  section('The other order, and one without the other');
  const reversed = await build(server.url, 'ph_reversed', ['flag-details.sql', 'admin-log.sql']);
  check('they apply the other way round too',
    (await reversed.query(`select to_regclass('public.admin_log') is not null as there`)).rows[0].there
    && Boolean(await column(reversed, 'runs', 'claimed_score')));
  const reversedPrint = (await reversed.query(FINGERPRINT)).rows[0].fingerprint;
  check('and land on exactly the same schema', JSON.stringify(reversedPrint) === JSON.stringify(once));

  // A deployment may well run one and not the other, so neither may depend on the other.
  const logOnly = await build(server.url, 'ph_log_only', ['admin-log.sql']);
  check('admin-log.sql alone applies, and leaves runs as it found it',
    !(await column(logOnly, 'runs', 'claimed_score')));
  const flagOnly = await build(server.url, 'ph_flag_only', ['flag-details.sql']);
  check('flag-details.sql alone applies, and adds no table',
    (await flagOnly.query(`select to_regclass('public.admin_log') is null as missing`)).rows[0].missing
    && Boolean(await column(flagOnly, 'runs', 'verified_score')));

  await base.end(); await db.end(); await reversed.end(); await logOnly.end(); await flagOnly.end();
} finally {
  await server.stop();
}

console.log(`\n${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
