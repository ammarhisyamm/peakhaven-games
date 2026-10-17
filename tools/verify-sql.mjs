// Runs a Supabase migration against a real, throwaway Postgres before it is ever run in production, and then
// exercises everything it adds: the functions, their concurrency, the grants and the row-level policies.
//
//   npm i --no-save pg embedded-postgres@15
//   node tools/verify-sql.mjs
//
// It never touches a live database. By default it starts its own Postgres in a temporary directory and throws
// it away afterwards. Point PGURL at a database you do not mind losing to use that instead.
//
//   PGURL=postgres://...         use this database rather than starting one (it is dropped and rebuilt)
//   VERIFY_SQL_MODULES=<dir>     where to find pg and embedded-postgres, if they are not installed here
//   VERIFY_SQL_ROUNDS=50         how many times to run the concurrency race
//   VERIFY_SQL_PORT=54329        port for the Postgres it starts
//   VERIFY_SQL_KEEP=1            leave the database running afterwards, to poke at it
//
// What it builds first is a stand-in for the live project: Supabase's three roles, its default privileges on
// the public schema (which is why a new table starts out readable by anon, and why a migration has to revoke
// that), an auth.users table and an auth.uid() that reads a session setting. Then the production schema as it
// is on origin/main, and only then the migration under test.
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFile, rm, mkdtemp} from 'node:fs/promises';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROUNDS = Number(process.env.VERIFY_SQL_ROUNDS || 50);
const PORT = Number(process.env.VERIFY_SQL_PORT || 54329);

// pg and embedded-postgres are not dependencies of this repo: the tests run on node alone. Install them with
// --no-save when you need this, or point VERIFY_SQL_MODULES at somewhere that has them.
const require = createRequire(process.env.VERIFY_SQL_MODULES ? join(resolve(process.env.VERIFY_SQL_MODULES), 'index.cjs') : import.meta.url);
function load(name) {
  try {return require.resolve(name);}
  catch {throw new Error(`${name} is not installed. Run: npm i --no-save pg embedded-postgres@15   (or set VERIFY_SQL_MODULES)`);}
}
const pg = require(load('pg'));

let failures = 0, checks = 0;
const check = (label, pass, detail = '') => {
  checks++;
  if (!pass) failures++;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
};
const section = title => console.log(`\n== ${title}`);
const gitShow = path => execFileSync('git', ['show', `origin/main:${path}`], {cwd: root, encoding: 'utf8', maxBuffer: 1 << 24});

// Supabase's own scaffolding, as far as a migration can see it: the roles, the default privileges that make a
// new public table readable by the browser's keys, and the auth schema the players table points at.
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
-- Stand-in for Supabase's auth.uid(): the tests set the session variable the way a signed-in request would.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

async function startPostgres() {
  if (process.env.PGURL) return {url: process.env.PGURL, stop: async () => {}, label: 'PGURL'};
  const EmbeddedPostgres = (await import(pathToFileURL(load('embedded-postgres')).href)).default;
  const dir = await mkdtemp(join(tmpdir(), 'ph-verify-sql-'));
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

// A fresh database, built up to a chosen point: 'production' is what is live now, 'migrated' has the file
// under test applied on top.
async function build(adminUrl, name, {migration = null, twice = false} = {}) {
  const admin = new pg.Client({connectionString: adminUrl});
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = adminUrl.replace(/\/[^/]*$/, `/${name}`);
  const db = new pg.Client({connectionString: url});
  await db.connect();
  await db.query(SUPABASE_BASELINE);
  await db.query(gitShow('arcade/supabase/schema.sql'));
  await db.query(gitShow('arcade/supabase/month-end.sql'));
  if (migration) {
    await db.query(migration);
    if (twice) await db.query(migration);
  }
  return {db, url};
}

// Everything about the schema a second run of a migration could possibly change.
const FINGERPRINT = `
select json_build_object(
  'columns', (select json_agg(x) from (select table_name, column_name, data_type, is_nullable, column_default
     from information_schema.columns where table_schema = 'public' order by table_name, column_name) x),
  'constraints', (select json_agg(x) from (select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
     from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2) x),
  'indexes', (select json_agg(x) from (select tablename, indexname, indexdef from pg_indexes
     where schemaname = 'public' order by 1, 2) x),
  'policies', (select json_agg(x) from (select tablename, policyname, cmd, roles::text, qual
     from pg_policies where schemaname = 'public' order by 1, 2) x),
  'functions', (select json_agg(x) from (select p.proname, pg_get_function_identity_arguments(p.oid) as args, md5(p.prosrc) as body
     from pg_proc p where pronamespace = 'public'::regnamespace order by 1, 2) x),
  'table_grants', (select json_agg(x) from (select table_name, grantee, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon','authenticated','service_role','PUBLIC') order by 1, 2, 3) x),
  'function_grants', (select json_agg(x) from (select p.proname, pg_get_function_identity_arguments(p.oid) as args, a.grantee, a.privilege_type
     from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e,
          lateral (select pg_get_userbyid(e.grantee) as grantee, e.privilege_type) a
     where p.pronamespace = 'public'::regnamespace order by 1, 2, 3) x)
) as fingerprint`;

const uuid = () => crypto.randomUUID();
// A player, with their auth user, straight into the tables.
async function newPlayer(db, name, coins = 0) {
  const id = uuid();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@verify.test`]);
  await db.query('insert into public.players (id, name, bottle) values ($1, $2, $3)', [id, name, 'ph-original']);
  if (coins) await db.query('select public.adjust_coins($1, $2, $3, $4)', [id, coins, 'set up by the harness', 'harness@verify.test']);
  return id;
}
async function newPurchase(db, playerId, coins, cents, reference) {
  const {rows} = await db.query(
    `insert into public.purchases (player_id, pack, coins, amount_cents, currency, reference, provider)
     values ($1, $2, $2, $3, 'AUD', $4, 'manual') returning *`, [playerId, coins, cents, reference]);
  return rows[0];
}
const coinsOf = async (db, id) => Number((await db.query('select coins from public.players where id = $1', [id])).rows[0].coins);
const START = 'select * from public.start_run($1, $2, $3, $4, $5, $6, $7)';
const DAY = '2026-10-17';
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

const server = await startPostgres();
console.log(`Postgres: ${server.label}`);
let migrated;
try {
  const migration = await readFile(join(root, 'arcade/supabase/paid-tries.sql'), 'utf8');

  // ---------------------------------------------------------------- the migration itself
  section('The migration applies to the production schema, and applies twice');
  const production = await build(server.url, 'ph_production');
  console.log(`  (baseline: ${(await production.db.query('select version()')).rows[0].version.split(',')[0]})`);
  const before = (await production.db.query(FINGERPRINT)).rows[0].fingerprint;
  check('the production schema has no paid-tries tables yet',
    !JSON.stringify(before.columns).includes('coin_ledger'));

  let applied = null;
  try {await production.db.query(migration); applied = true;} catch (error) {applied = error.message;}
  check('paid-tries.sql applies to the live schema', applied === true, applied === true ? '' : String(applied));
  const once = (await production.db.query(FINGERPRINT)).rows[0].fingerprint;
  let again = null;
  try {await production.db.query(migration); again = true;} catch (error) {again = error.message;}
  check('and applies a second time without error', again === true, again === true ? '' : String(again));
  const twice = (await production.db.query(FINGERPRINT)).rows[0].fingerprint;
  check('running it twice changes nothing', JSON.stringify(once) === JSON.stringify(twice),
    JSON.stringify(once) === JSON.stringify(twice) ? '' : 'the schema differs after a second run');
  await production.db.end();

  // A clean database at the migrated state for everything below.
  migrated = await build(server.url, 'ph_migrated', {migration, twice: true});
  const db = migrated.db;

  // ---------------------------------------------------------------- shape
  section('What it added');
  const cols = (await db.query(`select table_name, column_name, data_type, is_nullable from information_schema.columns
    where table_schema='public' and table_name in ('purchases','coin_ledger') order by table_name, ordinal_position`)).rows;
  check('purchases has the columns it should',
    cols.filter(c => c.table_name === 'purchases').map(c => c.column_name).join(',') ===
    'id,player_id,pack,coins,amount_cents,currency,reference,provider,status,created_at,resolved_at,resolved_by');
  check('coin_ledger has the columns it should',
    cols.filter(c => c.table_name === 'coin_ledger').map(c => c.column_name).join(',') ===
    'id,player_id,delta,reason,purchase_id,run_id,admin_email,note,created_at');
  const playerCoins = (await db.query(`select data_type, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='players' and column_name='coins'`)).rows[0];
  check('players.coins is a non-null integer defaulting to 0',
    playerCoins?.data_type === 'integer' && playerCoins.is_nullable === 'NO' && playerCoins.column_default === '0');
  const paidCol = (await db.query(`select data_type, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='runs' and column_name='paid'`)).rows[0];
  check('runs.paid is a non-null boolean defaulting to false',
    paidCol?.data_type === 'boolean' && paidCol.is_nullable === 'NO' && paidCol.column_default === 'false');
  const cons = (await db.query(`select conname, pg_get_constraintdef(oid) as def from pg_constraint
    where connamespace='public'::regnamespace order by conname`)).rows;
  check('the balance cannot go negative at the database level',
    cons.some(c => c.conname === 'players_coins_not_negative' && /coins >= 0/.test(c.def)));
  check('a reference is unique', cons.some(c => /purchases_reference/.test(c.conname) && c.def.startsWith('UNIQUE')));
  const idx = (await db.query(`select indexname, indexdef from pg_indexes where schemaname='public' order by indexname`)).rows;
  check('a purchase can only ever be granted once',
    idx.some(i => i.indexname === 'coin_ledger_one_grant' && /UNIQUE/.test(i.indexdef) && /reason = 'purchase'/.test(i.indexdef)));
  const rls = (await db.query(`select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace
    and relname in ('purchases','coin_ledger')`)).rows;
  check('row-level security is on for both new tables', rls.length === 2 && rls.every(r => r.relrowsecurity));

  // ---------------------------------------------------------------- grant_purchase
  section('grant_purchase');
  const ann = await newPlayer(db, 'Ann');
  const p1 = await newPurchase(db, ann, 10, 1799, 'PHA-AAAA');
  const first = (await db.query('select public.grant_purchase($1, $2) as r', [p1.id, 'boss@peak.test'])).rows[0].r;
  check('marking a purchase paid grants its coins', first.granted === true && first.balance === 10, JSON.stringify(first));
  const second = (await db.query('select public.grant_purchase($1, $2) as r', [p1.id, 'boss@peak.test'])).rows[0].r;
  check('a second call grants nothing', second.granted === false && second.balance === 10, JSON.stringify(second));
  // Two admins clicking at the same moment, on two connections.
  const racers = [new pg.Client({connectionString: migrated.url}), new pg.Client({connectionString: migrated.url})];
  await Promise.all(racers.map(c => c.connect()));
  const p2 = await newPurchase(db, ann, 5, 999, 'PHA-BBBB');
  const both = await Promise.all(racers.map(c => c.query('select public.grant_purchase($1, $2) as r', [p2.id, 'boss@peak.test'])));
  check('two at once grant exactly one lot of coins',
    both.filter(r => r.rows[0].r.granted).length === 1 && await coinsOf(db, ann) === 15,
    JSON.stringify(both.map(r => r.rows[0].r.granted)));
  await Promise.all(racers.map(c => c.end()));
  const grants = (await db.query(`select count(*)::int as n from public.coin_ledger where reason='purchase' and purchase_id=$1`, [p1.id])).rows[0].n;
  check('and there is exactly one ledger row per purchase', grants === 1, `rows=${grants}`);
  check('the grant records which admin did it',
    (await db.query(`select admin_email from public.coin_ledger where purchase_id=$1 and reason='purchase'`, [p1.id])).rows[0].admin_email === 'boss@peak.test');
  check('an unknown purchase is reported, not raised',
    (await db.query('select public.grant_purchase($1, $2) as r', [uuid(), 'boss@peak.test'])).rows[0].r.found === false);

  // ---------------------------------------------------------------- cancel_purchase
  section('cancel_purchase');
  const p3 = await newPurchase(db, ann, 1, 299, 'PHA-CCCC');
  const cancelled = (await db.query('select public.cancel_purchase($1, $2) as r', [p3.id, 'boss@peak.test'])).rows[0].r;
  check('cancelling closes it and grants nothing', cancelled.cancelled === true && await coinsOf(db, ann) === 15, JSON.stringify(cancelled));
  check('cancelling twice does nothing',
    (await db.query('select public.cancel_purchase($1, $2) as r', [p3.id, 'boss@peak.test'])).rows[0].r.cancelled === false);
  check('cancelling something already paid does nothing',
    (await db.query('select public.cancel_purchase($1, $2) as r', [p1.id, 'boss@peak.test'])).rows[0].r.cancelled === false &&
    await coinsOf(db, ann) === 15);
  check('and the cancellation is logged with the admin email',
    (await db.query(`select count(*)::int as n from public.coin_ledger where purchase_id=$1 and reason='admin' and admin_email='boss@peak.test'`, [p3.id])).rows[0].n === 1);

  // ---------------------------------------------------------------- adjust_coins
  section('adjust_coins');
  const ben = await newPlayer(db, 'Ben');
  const up = (await db.query('select public.adjust_coins($1, $2, $3, $4) as r', [ben, 5, 'paid at the shop', 'boss@peak.test'])).rows[0].r;
  check('a positive adjustment gives coins', up.balance === 5 && up.delta === 5, JSON.stringify(up));
  const down = (await db.query('select public.adjust_coins($1, $2, $3, $4) as r', [ben, -100, 'chargeback', 'boss@peak.test'])).rows[0].r;
  check('taking more than they have empties the balance', down.balance === 0 && down.delta === -5, JSON.stringify(down));
  check('and the ledger records what was actually taken',
    (await db.query(`select delta, note, admin_email from public.coin_ledger where player_id=$1 order by created_at desc, id desc limit 1`, [ben])).rows[0].delta === -5);
  const none = (await db.query('select public.adjust_coins($1, $2, $3, $4) as r', [ben, -3, 'again', 'boss@peak.test'])).rows[0].r;
  check('a no-op adjustment is still logged, and says so', none.delta === 0 &&
    /no change/.test((await db.query(`select note from public.coin_ledger where player_id=$1 order by created_at desc, id desc limit 1`, [ben])).rows[0].note));
  check('a note is required', await refused(db.query('select public.adjust_coins($1, $2, $3, $4)', [ben, 1, '   ', 'boss@peak.test'])) !== null);
  check('an unknown player is reported, not raised',
    (await db.query('select public.adjust_coins($1, $2, $3, $4) as r', [uuid(), 1, 'who', 'boss@peak.test'])).rows[0].r.found === false);
  check('the check constraint refuses a negative balance written directly',
    await refused(db.query('update public.players set coins = -1 where id = $1', [ben])) === '23514');

  // ---------------------------------------------------------------- start_run
  section('start_run: free tries first, then coins');
  const cat = await newPlayer(db, 'Cat', 2);
  const seed = 12345, free = [];
  for (let i = 0; i < 3; i++) {
    const {rows} = await db.query(START, [cat, 'blocks', DAY, seed, 3, null, true]);
    free.push(rows[0]);
  }
  check('the three free tries are free', free.length === 3 && free.every(r => r.paid === false) && await coinsOf(db, cat) === 2);
  const paidRun = (await db.query(START, [cat, 'blocks', DAY, seed, 3, null, true])).rows[0];
  check('the fourth run is paid for', paidRun?.paid === true && await coinsOf(db, cat) === 1, JSON.stringify(paidRun?.paid));
  check('and it is logged against the run it started',
    (await db.query(`select delta, run_id from public.coin_ledger where reason='run' and run_id=$1`, [paidRun.id])).rows[0]?.delta === -1);
  check('a paid run does not use up a free try',
    (await db.query(`select count(*)::int as n from public.runs where player_id=$1 and game='blocks' and day=$2 and not paid`, [cat, DAY])).rows[0].n === 3);
  check('another game still has its free tries',
    (await db.query(START, [cat, 'ridge', DAY, seed, 3, null, true])).rows[0].paid === false && await coinsOf(db, cat) === 1);
  await db.query(START, [cat, 'blocks', DAY, seed, 3, null, true]);
  check('the last coin buys the last run', await coinsOf(db, cat) === 0);
  check('with no coins left, no run is made',
    (await db.query(START, [cat, 'blocks', DAY, seed, 3, null, true])).rowCount === 0 && await coinsOf(db, cat) === 0);
  check('a caller that does not allow paid runs never spends a coin',
    await (async () => {
      await db.query('select public.adjust_coins($1, 5, $2, $3)', [cat, 'top up', 'boss@peak.test']);
      const r = await db.query(START, [cat, 'blocks', DAY, seed, 3, null, false]);
      return r.rowCount === 0 && await coinsOf(db, cat) === 5;
    })());
  const requestId = uuid();
  const once1 = (await db.query(START, [cat, 'blocks', DAY, seed, 3, requestId, true])).rows[0];
  const once2 = (await db.query(START, [cat, 'blocks', DAY, seed, 3, requestId, true])).rows[0];
  check('a retried start returns the same run and spends one coin',
    once1.id === once2.id && await coinsOf(db, cat) === 4, `${once1.id} / ${once2.id}`);

  // ---------------------------------------------------------------- refund_purchase
  section('refund_purchase');
  const dee = await newPlayer(db, 'Dee');
  const p4 = await newPurchase(db, dee, 5, 999, 'PHA-DDDD');
  await db.query('select public.grant_purchase($1, $2)', [p4.id, 'boss@peak.test']);
  for (let i = 0; i < 3; i++) await db.query(START, [dee, 'blocks', DAY, seed, 3, null, true]);
  const spent = [];
  for (let i = 0; i < 2; i++) spent.push((await db.query(START, [dee, 'blocks', DAY, seed, 3, null, true])).rows[0]);
  await db.query(`update public.runs set score = 900, status = 'closed' where id = any($1)`, [spent.map(r => r.id)]);
  const freeRun = (await db.query(START, [dee, 'ridge', DAY, seed, 3, null, true])).rows[0];
  await db.query(`update public.runs set score = 400, status = 'closed' where id = $1`, [freeRun.id]);
  check('two of the five coins are spent', await coinsOf(db, dee) === 3);
  const refund = (await db.query('select public.refund_purchase($1, $2) as r', [p4.id, 'boss@peak.test'])).rows[0].r;
  check('the refund takes back only the unspent coins',
    refund.refunded === true && refund.unspent === 3 && refund.removed === 3 && refund.runs === 2 && refund.balance === 0,
    JSON.stringify(refund));
  const voided = (await db.query(`select id, status, reject_reason from public.runs where id = any($1)`, [spent.map(r => r.id)])).rows;
  check('the runs its coins paid for stop counting',
    voided.length === 2 && voided.every(r => r.status === 'rejected' && r.reject_reason === 'Refunded purchase PHA-DDDD'),
    JSON.stringify(voided.map(r => r.status)));
  check('a free run is none of a refund\'s business',
    (await db.query('select status from public.runs where id = $1', [freeRun.id])).rows[0].status === 'closed');
  check('and the refund is logged with who did it',
    /2 paid run\(s\)/.test((await db.query(`select note from public.coin_ledger where purchase_id=$1 and reason='refund'`, [p4.id])).rows[0].note));
  check('refunding again does nothing',
    (await db.query('select public.refund_purchase($1, $2) as r', [p4.id, 'boss@peak.test'])).rows[0].r.refunded === false && await coinsOf(db, dee) === 0);
  check('a purchase that was never paid cannot be refunded',
    (await db.query('select public.refund_purchase($1, $2) as r', [p3.id, 'boss@peak.test'])).rows[0].r.refunded === false);

  section('refund_purchase: the coins it owns are its own, oldest first');
  // Two coins by hand, then a purchase of five, then four runs: the first two runs spent the older coins, so
  // only the last two belong to the purchase.
  const eve = await newPlayer(db, 'Eve');
  await db.query('select public.adjust_coins($1, 2, $2, $3)', [eve, 'two by hand first', 'boss@peak.test']);
  const p5 = await newPurchase(db, eve, 5, 999, 'PHA-EEEE');
  await db.query('select public.grant_purchase($1, $2)', [p5.id, 'boss@peak.test']);
  for (let i = 0; i < 3; i++) await db.query(START, [eve, 'sequence', DAY, seed, 3, null, true]);
  const spends = [];
  for (let i = 0; i < 4; i++) spends.push((await db.query(START, [eve, 'sequence', DAY, seed, 3, null, true])).rows[0]);
  const fifo = (await db.query('select public.refund_purchase($1, $2) as r', [p5.id, 'boss@peak.test'])).rows[0].r;
  check('it drops only the runs its own coins paid for', fifo.runs === 2 && fifo.unspent === 3 && fifo.removed === 3, JSON.stringify(fifo));
  const states = (await db.query('select id, status from public.runs where id = any($1)', [spends.map(r => r.id)])).rows;
  const dropped = new Set(states.filter(r => r.status === 'rejected').map(r => r.id));
  check('and they are the two later ones, not the two earlier ones',
    !dropped.has(spends[0].id) && !dropped.has(spends[1].id) && dropped.has(spends[2].id) && dropped.has(spends[3].id),
    JSON.stringify(states.map(r => r.status)));

  // ---------------------------------------------------------------- concurrency
  section(`Two connections, one coin, ${ROUNDS} times`);
  const one = new pg.Client({connectionString: migrated.url}), two = new pg.Client({connectionString: migrated.url});
  await one.connect(); await two.connect();
  let races = 0, bad = [];
  for (let round = 0; round < ROUNDS; round++) {
    const racer = await newPlayer(db, `Race${round}`, 1);
    for (let i = 0; i < 3; i++) await db.query(START, [racer, 'blocks', DAY, seed, 3, null, false]);
    // No explicit transaction: each call is its own, exactly as PostgREST issues an RPC, so the advisory lock
    // is taken and released inside the statement and the two really do race.
    const [a, b] = await Promise.all([
      one.query(START, [racer, 'blocks', DAY, seed, 3, null, true]),
      two.query(START, [racer, 'blocks', DAY, seed, 3, null, true]),
    ]);
    const made = a.rowCount + b.rowCount, balance = await coinsOf(db, racer);
    const paid = (await db.query(`select count(*)::int as n from public.runs where player_id=$1 and paid`, [racer])).rows[0].n;
    const ledger = (await db.query(`select count(*)::int as n from public.coin_ledger where player_id=$1 and reason='run'`, [racer])).rows[0].n;
    if (made === 1 && balance === 0 && paid === 1 && ledger === 1) races++;
    else bad.push({round, made, balance, paid, ledger});
  }
  await one.end(); await two.end();
  check(`one coin only ever makes one run (${races}/${ROUNDS})`, races === ROUNDS, bad.length ? JSON.stringify(bad.slice(0, 3)) : '');

  // ---------------------------------------------------------------- permissions
  section('What a browser key can do');
  const fay = await newPlayer(db, 'Fay', 0);
  const pf = await newPurchase(db, fay, 1, 299, 'PHA-FFFF');
  await db.query('select public.grant_purchase($1, $2)', [pf.id, 'boss@peak.test']);
  const FUNCTIONS = [
    ['grant_purchase', 'select public.grant_purchase($1, $2)', [pf.id, 'attacker@example.com']],
    ['cancel_purchase', 'select public.cancel_purchase($1, $2)', [pf.id, 'attacker@example.com']],
    ['adjust_coins', 'select public.adjust_coins($1, 999, $2, $3)', [fay, 'free coins', 'attacker@example.com']],
    ['refund_purchase', 'select public.refund_purchase($1, $2)', [pf.id, 'attacker@example.com']],
    ['start_run(7)', START, [fay, 'blocks', DAY, seed, 3, null, true]],
    ['start_run(6)', 'select * from public.start_run($1,$2,$3,$4,$5,$6)', [fay, 'blocks', DAY, seed, 3, null]],
    ['use_invite', 'select public.use_invite($1)', ['DEV']],
  ];
  for (const role of ['anon', 'authenticated']) {
    await asRole(db, role, fay);
    for (const [name, sql, args] of FUNCTIONS) {
      const code = await refused(db.query(sql, args));
      check(`${role} cannot run ${name}`, code === '42501', code === null ? 'it ran' : `code ${code}`);
    }
  }
  await asOwner(db);
  check('the balance was not touched by any of that', await coinsOf(db, fay) === 1);

  section('What a signed-in player can read');
  const gus = await newPlayer(db, 'Gus', 0);
  const pg2 = await newPurchase(db, gus, 5, 999, 'PHA-GGGG');
  await db.query('select public.grant_purchase($1, $2)', [pg2.id, 'boss@peak.test']);
  await asRole(db, 'authenticated', fay);
  const ownPlayers = (await db.query('select id from public.players')).rows;
  check('a player sees only their own player row', ownPlayers.length === 1 && ownPlayers[0].id === fay, `rows=${ownPlayers.length}`);
  const ownPurchases = (await db.query('select reference, player_id from public.purchases')).rows;
  check('and only their own purchases', ownPurchases.length === 1 && ownPurchases[0].reference === 'PHA-FFFF', JSON.stringify(ownPurchases.map(r => r.reference)));
  const ownLedger = (await db.query('select player_id from public.coin_ledger')).rows;
  check('and only their own ledger', ownLedger.length > 0 && ownLedger.every(r => r.player_id === fay), `rows=${ownLedger.length}`);
  check('they can see their own balance',
    Number((await db.query('select coins from public.players')).rows[0].coins) === 1);
  check('they cannot see anyone else\'s runs', (await db.query('select id from public.runs')).rows.length === 0);
  check('they cannot see the invite codes', (await db.query('select code from public.invites')).rows.length === 0);
  for (const [what, sql, args] of [
    ['give themselves coins', 'update public.players set coins = 1000 where id = $1', [fay]],
    ['rename themselves', `update public.players set name = 'Hacked' where id = $1`, [fay]],
    ['add a player row', `insert into public.players (id, name) values ($1, 'Ghost')`, [uuid()]],
    ['write a ledger row', `insert into public.coin_ledger (player_id, delta, reason) values ($1, 1000, 'purchase')`, [fay]],
    ['mark their own purchase paid', `update public.purchases set status = 'paid' where id = $1`, [pf.id]],
    ['make a free purchase', `insert into public.purchases (player_id, pack, coins, amount_cents, reference) values ($1, 25, 25, 1, 'PHA-HACK')`, [fay]],
    ['delete their ledger', 'delete from public.coin_ledger', []],
    ['delete a purchase', 'delete from public.purchases', []],
  ]) {
    const code = await refused(db.query(sql, args));
    check(`a player cannot ${what}`, code === '42501', code === null ? 'it was allowed' : `code ${code}`);
  }
  await asOwner(db);
  check('after all of that the balance is still what it was', await coinsOf(db, fay) === 1);
  check('and no stray purchase was created',
    (await db.query(`select count(*)::int as n from public.purchases where reference = 'PHA-HACK'`)).rows[0].n === 0);
  const anonGrants = (await db.query(`select table_name, privilege_type from information_schema.role_table_grants
    where table_schema='public' and grantee in ('anon','authenticated') and table_name in ('purchases','coin_ledger')
    order by table_name, privilege_type`)).rows;
  check('the browser roles hold nothing but select on the new tables',
    anonGrants.every(g => g.privilege_type === 'SELECT'), JSON.stringify([...new Set(anonGrants.map(g => g.privilege_type))]));
  // The balance is cached on players, so a browser key must not hold a write grant on it either: nothing but
  // row-level security would be standing between a future policy and a player setting their own coins.
  const playerGrants = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='players' and grantee in ('anon','authenticated','PUBLIC')
    order by grantee, privilege_type`)).rows;
  check('and nothing but select on players, where the balance is cached',
    playerGrants.every(g => g.privilege_type === 'SELECT'), JSON.stringify(playerGrants));
  check('the service role can still write a player row',
    await (async () => {
      await asRole(db, 'service_role');
      const done = await refused(db.query(`update public.players set name = 'Fay' where id = $1`, [fay]));
      await asOwner(db);
      return done === null;
    })());

  // ---------------------------------------------------------------- going live, in both orders
  section('Migration first, then deploy');
  // The code that is live now calls the five and six argument start_run, and keeps doing so until the deploy
  // lands. Both must still work on a migrated database.
  const hal = await newPlayer(db, 'Hal', 3);
  const old5 = await db.query('select * from public.start_run($1,$2,$3,$4,$5)', [hal, 'blocks', DAY, seed, 3]);
  const old6 = await db.query('select * from public.start_run($1,$2,$3,$4,$5,$6)', [hal, 'blocks', DAY, seed, 3, uuid()]);
  check('the five argument start_run still works', old5.rowCount === 1 && old5.rows[0].paid === false);
  check('the six argument start_run still works', old6.rowCount === 1 && old6.rows[0].paid === false);
  check('and neither spends a coin', await coinsOf(db, hal) === 3);
  await db.query('select * from public.start_run($1,$2,$3,$4,$5,$6)', [hal, 'blocks', DAY, seed, 3, uuid()]);
  const oldOut = await db.query('select * from public.start_run($1,$2,$3,$4,$5,$6)', [hal, 'blocks', DAY, seed, 3, uuid()]);
  check('the old code still stops at three free tries even though they have coins',
    oldOut.rowCount === 0 && await coinsOf(db, hal) === 3);
  // And once the deploy lands, their coins become spendable with nothing else changing.
  check('and the new code can then spend them',
    (await db.query(START, [hal, 'blocks', DAY, seed, 3, null, true])).rows[0].paid === true && await coinsOf(db, hal) === 2);

  section('Deploy first, then migration');
  // The reverse order: new code against a database the migration has not reached. The seven argument function
  // is simply not there, which is the 42883 that the store treats as "not set up yet" and falls back on.
  const unmigrated = await build(server.url, 'ph_unmigrated');
  const ida = await newPlayer(unmigrated.db, 'Ida');
  const missing = await refused(unmigrated.db.query(START, [ida, 'blocks', DAY, seed, 3, null, true]));
  check('the seven argument start_run is reported as missing, not as a failure', missing === '42883', `code ${missing}`);
  check('the six argument one still serves a free try',
    (await unmigrated.db.query('select * from public.start_run($1,$2,$3,$4,$5,$6)', [ida, 'blocks', DAY, seed, 3, uuid()])).rowCount === 1);
  for (const [what, sql] of [
    ['purchases', 'select 1 from public.purchases'],
    ['coin_ledger', 'select 1 from public.coin_ledger'],
    ['players.coins', 'select coins from public.players'],
    ['runs.paid', 'select paid from public.runs'],
  ]) {
    const code = await refused(unmigrated.db.query(sql));
    check(`${what} is reported missing in the way the store expects`, code === '42P01' || code === '42703', `code ${code}`);
  }
  await unmigrated.db.end();
} finally {
  await migrated?.db?.end().catch(() => {});
  await server.stop();
}

console.log(`\n${checks} checks, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
