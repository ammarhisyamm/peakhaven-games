# Game audit — 15 October 2026

Scope: the production Arcade's Peak Blocks, Sequence and Ridge Run, including guest credits, ranked runs, results, account gating, and leaderboard recovery. Base: GitHub main `90d382a` (Peak Blocks difficulty curve). Existing artwork, scoring and progression rules were preserved.

## Findings addressed

| Priority | Failure / negative case | Change |
|---|---|---|
| P1 | A start response can be lost after the server spends a play; retry spends another | Persist a player/game-scoped request UUID through tab reload. A locked database RPC and unique player/request index return the original run on retry, even with zero plays remaining. |
| P1 | Repeating a verified result returns an error; repeating a cleared Sequence level can reject the continuing run | Identical verified replays return the current verified result. Comparison tolerates PostgreSQL jsonb key ordering. Concurrent submissions use compare-and-set and return the same success without adding points again. |
| P1 | Offline result offers only a fresh game, losing the unsent score | Offer **Try saving again**. Preserve pending inputs in session storage, scoped to the account, with retry/dismiss controls after reload. Starting a new ranked game waits for that decision. |
| P1 | Expired session during start can render Play over the sign-in screen | Route failures through account gating. Ignore stale account/profile/board/start responses after an account change. |
| P1 | Saved `tutorials` as an object throws `is not iterable` after using a play | Validate the saved field before spreading it. Sanitize non-finite saved game levels. |
| P2 | A second finger takes over a Blocks drag or Sequence swap; lost capture/blur leaves a held gesture | Bind the gesture to its initiating pointer. Clear capture and held state on cancel, lost capture, blur, pause and destroy; remove listeners on teardown. |
| P2 | Requests, including sign-in startup, can leave UI waiting indefinitely | Bound request and SDK/script loading time. Network failures and unreadable JSON produce recoverable messages. |
| P2 | Failure to load the player's daily allowances displays zero plays as if exhausted | Show **Plays unavailable**, with retry controls rather than a false exhausted state. |
| P2 | A failed leaderboard response stays cached without recovery | Add **Try again** to failed standings. |
| P2 | A failed game module leaves an empty full-screen iframe | Add a ready handshake and loading recovery with **Retry loading** and **Back to arcade**. Reloading the iframe retains the current play/run. |
| P2 | An open tab retains yesterday's exhausted allowances | Refresh server allowances when the visible tab returns, without interrupting a game or modal. |
| P2 | Denied access to the `localStorage` getter throws before credit error handling | Guard access to storage itself; reject an unsaved play or simulated purchase with recovery feedback. |
| P2 | Invalid replay clocks or unconsumed inputs can be accepted as a truncated replay | Validate input clocks and replay duration, reject unused inputs, and process legitimate inputs on the final tick before manual Finish. |
| P3 | Guest sample standings can be confused with competition standings | Label the preview **Demo standings**. |

## Verification evidence

- `npm test`: **160 passed, 0 failed** (149 at baseline, 11 added regression cases).
- `npm ci` in `arcade/`: pinned dependencies installed, audit reported 0 vulnerabilities. `npm run build` passed module syntax and import validation.
- `tools/audit-games.cjs`: **13 scenario groups passed in Chrome and WebKit**, each including four viewport widths (1440, 826, 390, 320). Covers all three games: actual input, pause/resume, Finish, replay, ranks, credit exhaustion, simulated coins, storage denial, corrupt save, ranked nonzero Blocks score, lost accepted finish response, lost accepted start response plus reload, pending score recovery, slow start/cancel, proxy HTML error, missing game module recovery, leaderboard outage, and a real canvas-driven Sequence win followed by the server-seeded second level within the same run.
- `tools/audit-negative-cases.cjs`: synthesized Chrome touch events with two fingers and cancellation for Blocks and Sequence, followed by working input; failed `/me` recovery; 401 session expiry; empty/invalid invite form. All five groups passed, with no unhandled page errors.
- Existing engine suites cover blocked trays and exhausted tools, undo/replay determinism, Sequence no-match/move exhaustion/dead-board reshuffle/high levels, Ridge collision, reachable gates, pause/resume and frame-rate independence. New regressions cover duplicate/concurrent finishes, duplicate starts at the final allowance, malformed replay clocks, final-tick Finish, storage-access exceptions, and pointer ownership/interruption.
- Browser checks use disposable local accounts and an in-memory API. No test accounts, scores or emails were created in production.

### Database

Applied `retry_safe_game_start` to PH-Arcade (`otqkugzwzwslzhrzmabv`) before deploying the new caller. The original five-argument RPC remains available for older deployments. Upgrade source: `arcade/supabase/start-request-idempotency.sql`; included in `schema.sql` for new installs.

Live read checks confirmed RLS on all three competition tables, the new request index/RPC, and execute permission for `service_role` only (not `anon` or `authenticated`). A transaction under `service_role` called the RPC with a zero play limit and returned zero runs, then rolled back.

Supabase's existing [RLS-without-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) match the intentional server-only data path. The existing [SECURITY DEFINER advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) concerns `rls_auto_enable`, whose inspected return type is `event_trigger`, not an Arcade RPC. The [password-protection advisory](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) concerns password auth; Arcade uses email links. Those unrelated settings were preserved; no new function advisory was introduced.

## Reproduce

Run in the repository root:

```sh
npm test
cd arcade
npm ci
npm run build
PORT=8781 npm run dev
```

In a second terminal at the repository root, with Playwright and its browsers installed:

```sh
node tools/audit-games.cjs
PH_WEBKIT=1 node tools/audit-games.cjs
node tools/audit-negative-cases.cjs
```

`PH_PLAYWRIGHT_MODULE` can point to an existing Playwright module directory. `PH_AUDIT_BASE` overrides the local server URL without skipping account tests. `PH_AUDIT_OUTPUT` selects the screenshot/JSON output directory. `PH_QA_URL` runs only the guest smoke matrix against a deployed URL. On macOS the Chrome runner uses the installed Chrome channel; `PH_CHROME_PATH` can override it.

## Practical limits

This establishes evidence for the scenarios above, not a guarantee that every possible bug is absent. WebKit is automation, not a physical iPhone/Safari run. Multitouch was synthesized in Chrome; physical iOS/Android gestures, haptic hardware and actual email-link delivery were not exercised. Coin purchases remain the authorized prototype simulation. Full-page reload during an unfinished game abandons that run; pending results already produced are recoverable within the same tab. The existing server replay limit is one hour.
