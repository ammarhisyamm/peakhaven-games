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
to Play, preserving the other pages. Game illustrations use landscape frames
(1672:941) with `cover` fitting; original supplied images are preserved in
`source-assets/`. Proportional result mascots and game wordmarks use `contain`.

The prototype tracks three free game launches per game per local calendar day
on this device. A launch is counted when the instruction dialog's start button
is pressed; cancelling instructions uses no play. Every result replay and
Sequence next-level launch also consumes a play. Free plays are used first;
after those are exhausted, one shared blue coin starts one run in any of the
three games. Blue play credits are separate from the gameplay engine's cosmetic
and reward coins and persist locally when the daily free allowance resets.

The coin shop offers 1 / 5 / 10 / 25 blue coins with illustrative A$2.99 /
A$9.99 / A$17.99 / A$29.99 prices. Purchases are explicitly prototype
simulations: coins are saved on this device and no payment is taken. The result
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
- Tests: `npm test` in the repo root (`tests/competition.test.js`).

Environment variables (Vercel, Production and Preview): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (added automatically by the Vercel Supabase integration) and `RUN_SEED_SECRET`
(any long random string; changing it changes every daily course).

Local preview with working accounts and no Supabase: `npm install && npm run build && npm run dev`, then open
http://localhost:8775/#play and join with invite code `DEV`. Data is kept in memory only.

Running the competition (Supabase SQL editor):

```sql
insert into public.invites (code, max_uses, note) values ('PEAK-7Q2X', 1, 'for Sam');      -- new invite
select * from public.runs where flagged or status = 'rejected' order by updated_at desc;     -- review
```
