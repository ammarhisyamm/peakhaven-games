# Peak Haven Arcade production app

Production: https://peakhaven-arcade.vercel.app/#play

The Vercel `peakhaven-arcade` project deploys this directory from `main`.
Every push or merge into `main` triggers a production build. Other branches
get preview deployments. Takiyoruu already has write access to this repository.

## Where to make changes

- Gameplay engines, rules, sounds and game artwork: `../dist/`.
- V2 pages (Play, Ranks, Prizes, My Bottle), layout and page artwork: `ui/`.
- Game iframe navigation, HUD and session bridge: `ui/game/app.js`.
- V2 toolbar spacing and line-clear feedback styles: `ui/game/arcade-overrides.css`.
- Peak Blocks, Ridge Run and Sequence result/coin panels: `ui/game/reference-results.js`
  and `ui/game/reference-results.css`.
- Daily free launches and shared blue play credits: `../dist/play-credits.js`.

`npm run build` assembles the current gameplay source and the V2 interface into
`build/`. The original `../dist/app.js` remains the original arcade demo; it does
not replace the production V2 interface. Changes to game modules and artwork in
`../dist/` are copied automatically on every build, with no manual asset sync.

The build checks JavaScript syntax and local imports before publishing. If the
build fails, the last successful production deployment keeps serving traffic.
`/version.json` exposes the deployed Git commit for release verification.

## Local preview

From this directory:

```sh
npm run build
npm run preview
```

Open http://localhost:8775/#play.

## Vercel settings

- Repository: `ammarhisyamm/peakhaven-games`
- Production branch: `main`
- Root directory: `arcade`
- Include source files outside root directory: enabled (gameplay lives in `../dist`)
- Build command: `npm run build`
- Output directory: `build`
- Ignored Build Step: `exit 1` (build every push, including changes in gameplay source)

No GitHub Actions token or deployment hook is needed; Vercel's Git integration
performs automatic builds and assigns the production domain after success.

## Daily Play reference

Play follows the supplied October 13 layout: campaign hero, monthly/yearly
prizes, Peak Blocks / Sequence / Ridge Run rows, leaderboard preview, bottle
customisation shortcut and extra-plays concept. `ui/play.css` scopes the layout
to Play, preserving the other pages. Game cards show real gameplay frames
(1672:941, captured from each game) with the player's bottle as a small corner
badge; original supplied images are preserved in `source-assets/`. Proportional result mascots and game wordmarks use `contain`.

The prototype tracks three free game launches per game per local calendar day
on this device. A launch is counted when the instruction dialog's start button
is pressed; cancelling instructions uses no play. Every result replay and
Sequence next-level launch also consumes a play. Free plays are used first;
after those are exhausted, one shared blue coin starts one run in any of the
three games. Blue play credits are separate from the gameplay engine's cosmetic
and reward coins and persist locally when the daily free allowance resets.

The coin shop offers 1 / 5 / 10 / 25 blue coins with illustrative A$2.99 /
A$9.99 / A$17.99 / A$29.99 prices. Purchases are simulated: coins
are saved on this device and the shop states that no payment is taken. The result
shop confirms that save before starting a fresh run; the Play-page shop adds
coins without starting a game. Storage failure reports feedback and blocks the
affected launch or simulated purchase.

The October 14 client gameplay/result/shop references and observed responsive
rules are documented in [GAME_REFERENCE_UX.md](GAME_REFERENCE_UX.md). The root
`DESIGN.md` and `.impeccable/design.json` continue to describe the incumbent
Alpine Lab application; this scoped production extension does not replace them.

## Accounts and the leaderboard

Invite-only accounts, 3 free plays per game per day and the monthly/yearly leaderboard run on Supabase plus the
Vercel functions in `api/`. Every score is replayed on the server with the gameplay code from `../dist/` before
it counts, so a changed client can't post a fake score.

- `api/*.js`: thin Vercel wrappers. Logic lives in `server/handlers.mjs`; rules (Melbourne days, shared daily
  seeds, rank points) in `server/competition.mjs`; replay checks in `server/verify.mjs`.
- `supabase/schema.sql`: tables, Row Level Security and the two database functions. Run it once in the SQL editor.
- `ui/account.js`: sign-in by emailed link and calls to `/api`. Without `/api/config` (plain static preview)
  the arcade falls back to the on-device demo.
- Leaderboards are per game: `GET /api/leaderboard?period=monthly|yearly&game=blocks|sequence|ridge` ranks
  each player's best score in that game. Without `game` it returns the overall rank-points table that decides
  prizes (each game's monthly board earns 100, 90, 80… points; the three games add up).
- Bottle skins unlock with lifetime points (`ui/bottle-unlocks.js`, shared by the page and the API): every
  finished game earns a tenth of its score, at least 10 and at most 250. Sky Molecule 500, Ice Flow 2,500,
  Deep Hex 7,500, Violet Bloom 15,000, Golden Peak 30,000 or a top-three monthly finish. `/api/profile`
  refuses to equip a locked bottle.
- Tests: `npm test` in the repo root (`tests/competition.test.js`).

Environment variables (Vercel, Production and Preview): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (added automatically by the Vercel Supabase integration), `RUN_SEED_SECRET`
(any long random string; changing it changes every daily course) and `ARCADE_ADMIN_EMAILS` (comma separated;
these accounts can open `/admin.html`, finalise monthly results and resolve purchases). Paid extra tries add
`ARCADE_PAYMENT_PROVIDER` and the `ARCADE_PAY_*` details below.

## End of month

Prizes go to **1st place in each game**, so a month has three winners: Peak Blocks, Sequence and Ridge Run.
Second and third are archived so last month's podium can be shown, and win nothing.

- `ui/month-prizes.js` holds the rule shared by the pages and the API: the prize line per game (blank falls
  back to "1st place wins a prize"), the winner modal's wording, and the winner email list.
- `server/competition.mjs`: `monthPodium` and `monthResults` build a month's archive. A leaderboard lets
  equal scores share a rank, but a prize cannot, so podium places are positional and equal scores are split by
  whoever got there first. Exactly one winner per game.
- `month_results` keeps the top three of each game with a `winner` flag, true for rank 1 only.
  `month_prizes` keeps one line of prize text per game.
- **Existing projects need the migration**: run `supabase/month-end.sql` once in the Supabase SQL editor.
  It is idempotent, and new projects get these tables from `schema.sql` already. Until it has run, the
  arcade carries on without them — the leaderboard, `/api/me` and the games behave normally, every board
  shows the default prize line, "Last month's winners" stays hidden, and the admin page says to run the file.
  Finalising a month is the only thing that needs the tables, and it answers 503 naming the file.
- `/admin.html` (admins only): check a finished month's podium, write the prize lines, and **Finalise**. Until
  it is finalised nothing is announced and the boards show no podium, so results can be reviewed first.
  Finalising marks the winners, which is what raises each winner's modal and puts the podium on the boards.
  **Winners** and **Copy winner emails** cover the three 1st places only; 2nd and 3rd are listed separately as
  backups. If a winner's run is disqualified during review, throw the run out and finalise again: the month's
  rows are replaced and the backup is promoted.
- Players see the prize line under a board's title, "Last month's winners" with 1st crowned and 2nd and 3rd as
  runners-up, and a winner sees one modal listing every game they topped (once per month, per device).
- Tests: `tests/month-end.test.js`.

## Paid extra tries

One coin buys one extra run of any ranked game, once that game's three free tries for the day are gone. Free
tries are always spent first, coins never expire, there is no daily cap, and a paid run is an ordinary run: it
is verified the same way and nothing on any leaderboard says it was paid for.

- Packs and prices live in `server/coins.mjs`: 1 for A$2.99, 5 for A$9.99, 10 for A$17.99 (the popular one)
  and 25 for A$29.99. A browser chooses a pack **by its coin count only**; the price is read on the server, so
  nothing a request sends about money is believed.
- `server/payments.mjs` is the payment step, one pluggable provider at a time (`ARCADE_PAYMENT_PROVIDER`,
  default `manual`). **manual** is bank transfer / PayID: the player gets a reference (`PHA-XXXX`, drawn from
  an alphabet with no 0/O, 1/I/L, 2/Z, 5/S, 8/B or 6/G so it cannot be mistyped), pays it, and an admin marks
  it paid. **stripe** is a documented stub and the package is deliberately not a dependency yet; the file says
  exactly what building it involves, and nothing else would have to change.
- Payment details come from the environment, never the repo: `ARCADE_PAY_ACCOUNT_NAME` and either
  `ARCADE_PAY_BSB` + `ARCADE_PAY_ACCOUNT_NUMBER` or `ARCADE_PAY_PAYID`, plus an optional one-line
  `ARCADE_PAY_NOTE`. **Until there is enough to actually pay, the shop is hidden entirely**, so merging this
  can never show a shop that does not work. Coins already granted can still be spent.
- `purchases` holds one request per reference with its status (pending, paid, cancelled, refunded).
  `coin_ledger` holds every coin in and out, and the balance on `players.coins` is a cache of it.
  `runs.paid` says which runs a coin paid for, and the three free tries are counted on `not paid`.
- Four database functions do everything that moves a coin, so each is one transaction and each is safe to call
  twice: `grant_purchase` (idempotent, so a second "Mark paid" grants nothing), `cancel_purchase`,
  `adjust_coins` (never below zero) and `refund_purchase`. `start_run` gained a seventh argument: once the
  free tries are gone it spends one coin and creates the run in the same locked step, so two taps with one coin
  left give exactly one run.
- A refund takes back whatever of that purchase's coins are **unspent**, and the runs its spent coins paid for
  are marked `rejected` with `Refunded purchase PHA-XXXX`, which is what keeps them off every board and out
  of lifetime points. Coins are spent oldest first, so which runs those are is worked out by walking the ledger
  with a queue of granted coins: `refundPlan` in `server/coins.mjs` and `refund_purchase` in the migration
  do the same walk, and the tests exercise the JavaScript one.
- **Existing projects need the migration**: run `supabase/paid-tries.sql` once in the Supabase SQL editor. It
  is idempotent, and new projects get all of it from `schema.sql` already. Until it has run, the arcade
  carries on without it — the leaderboard, `/api/me` and the games behave normally, nobody has coins, the shop
  stays hidden, and the admin page says to run the file. Buying or moving a coin answers 503 naming it.
- Row Level Security: a player may read their own purchases, their own ledger and their own row (where the
  balance is cached). Every write goes through the service role and the functions above, and the `anon` and
  `authenticated` grants on the two new tables are revoked down to `select`.
- `/admin.html` (admins only) also runs the money: purchases waiting for payment with the player's name,
  email, pack, amount and age; **Mark paid** (which grants the coins), **Cancel**, **Refund**, and coins given
  or taken by hand with a required note. Every one of those is logged with the admin's email.
- Players see the balance on Play and on My Bottle, "Waiting for payment" with the reference until it is
  resolved, "No free plays left · uses 1 of your N coins" on the game card, and a one-time "+N coins added"
  message the next time they visit after a payment is matched. With no accounts (a static preview) the shop
  stays the on-device demo in `dist/play-credits.js`.
- Row Level Security: a player may read their own purchases, their own ledger and their own row (where the
  balance is cached). Every write goes through the service role, and `anon` and `authenticated` are revoked
  down to `select` on the two new tables **and on `players`**, so nothing but a service-role call can move a
  coin even if a policy is added to that table later.
- Tests: `tests/paid-tries.test.js`, and `tools/verify-sql.mjs` for the SQL itself.

Locally the whole loop works without any of the environment variables: the dev server falls back to obvious
placeholder bank details, so buy a pack as a player, then **Mark paid** as `admin@dev.test` on `/admin.html`,
then play an extra try.

To reach the admin page locally: `ARCADE_ADMIN_EMAILS=you@example.com npm run dev` and join with that email,
or join as `admin@dev.test`, which is the default.

Local preview with working accounts and no Supabase: `npm install && npm run build && npm run dev`, then open
http://localhost:8775/#play and join with invite code `DEV`. Data is kept in memory only.

Running the competition (Supabase SQL editor):

```sql
insert into public.invites (code, max_uses, note) values ('PEAK-7Q2X', 1, 'for Sam');      -- new invite
select * from public.runs where flagged or status = 'rejected' order by updated_at desc;     -- review
select * from public.month_results where month = '2026-09' order by game, rank;              -- last month
select reference, coins, amount_cents, created_at from public.purchases where status = 'pending';  -- to match
select name, coins from public.players order by coins desc;                                  -- balances
```

## Checking a migration before it is run

`tools/verify-sql.mjs` runs a migration against a real, throwaway Postgres and then exercises what it adds.
It never touches a live database: by default it starts its own server in a temporary directory and throws it
away afterwards.

```
npm i --no-save pg embedded-postgres@15
node tools/verify-sql.mjs
```

It builds a stand-in for the live project first — Supabase's `anon`, `authenticated` and `service_role` roles,
its default privileges on the `public` schema (which is why a new table starts out writable by a browser key,
and why a migration has to revoke that), an `auth.users` table and an `auth.uid()` that reads a session
setting — then the production schema **as it is on `origin/main`**, and only then the migration under test.

What it then checks, for `supabase/paid-tries.sql`: that it applies to the live schema and applies a second
time with no change to the schema at all (compared by a fingerprint of every column, constraint, index, policy,
function body and grant); the shape of what it added; every function for real, including a double grant, a
refund's oldest-first attribution and an adjustment that cannot go below zero; a genuine race, with two
connections calling `start_run` for a player with one coin, repeated 50 times; that neither browser role can
execute any of the functions; that a signed-in player reads only their own rows and can write nothing; and that
the deployment works in **both** orders — the old code against a migrated database, and the new code against
one the migration has not reached.

Useful switches: `PGURL` to use a database you already have (it is dropped and rebuilt), `VERIFY_SQL_ROUNDS`
for the race, `VERIFY_SQL_KEEP=1` to leave the server up afterwards, and `VERIFY_SQL_MODULES` to point at
where `pg` and `embedded-postgres` are installed.

## Temporary guest prototype

The invite/sign-in screen also offers **Continue as guest** with a player icon.
Guest mode lasts for the current browser tab (including reloads) and uses local
play credits, scores and demo standings. It creates no account, sends no ranked
start/finish/profile requests, and uses no competition token. The footer’s
**Sign in** action returns to the existing invite flow; a real sign-in takes
precedence over a saved guest session.

Keep Going uses the existing snowy mountain asset behind its shop header and
result mascot. Coin and mountain URLs resolve from the supplied asset base, so
opening the component from Play or the game iframe loads the same materials.
