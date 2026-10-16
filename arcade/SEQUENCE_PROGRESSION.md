# Sequence progression

New games use rules version 3. The 7×7 crystal board and seeded scoring remain. Clear the score goal **and every objective** to advance. A failed level ends the ranked run; cleared levels keep the same run and add their verified scores.

## Version 3: specials, combos and a measured curve

`dist/sequence-v3.js` owns v3. The v1 and v2 modules are untouched, keep their own draw order, and keep replaying byte-exact.

A cell is one integer, `kind * 8 + colour`, so the board stays an array of numbers and a replay stays `{seed, moves}`. Plain crystals are `0..5` exactly as before, so the shared helpers still read them. Specials are therefore fully determined by the board and the move log, and need no new replay field.

### Special crystals

| Shape matched | Makes | What it does |
| --- | --- | --- |
| Four in a line | A striped crystal, at the swapped cell | Sweeps its whole row or column. A horizontal match makes a vertical stripe (which clears the column) and the other way round |
| An L or T of five | A wrapped crystal | Explodes 3×3, then explodes 3×3 again after the next settle |
| Five in a line | A colour bomb (white, no playable colour) | Clears every crystal of whatever it is swapped with. A bomb swap is always a legal move and spends one |

Five in a line beats an L or T, which beats four, as in Candy Crush. Anything special caught in a blast fires too, so chains run on their own; a colour bomb swept up by someone else's blast takes the commonest colour in that blast with it rather than being wasted. A special is never placed into a trap, because a trapped special could never be swapped.

### Combos, by swapping two specials together

| Combo | Clears |
| --- | --- |
| striped + striped | Its row and its column |
| striped + wrapped | Three rows and three columns |
| wrapped + wrapped | 5×5, twice over |
| bomb + striped | Every crystal of that colour becomes striped and fires |
| bomb + wrapped | Every crystal of that colour becomes wrapped and fires |
| bomb + bomb | The whole board |

Each is worth well more than the two specials would have been apart. A combo consumes the pair that made it, so neither also detonates on its own inside the blast.

### Objectives

PR #20's ice, traps and collection all still work, and specials now serve them: **every cleared cell** counts toward ice and traps, and toward collection by its own colour. Matching on or beside ice and traps still breaks them, so adjacency is unchanged. Collection counts cleared crystals only — a blast that merely passes beside the right colour never collects it.

The objective rotates on a six-level cycle from level 11 (`ice`, `collect`, `ice+traps`, `traps+collect`, `score`, `ice+collect`), so no two levels in a row play the same way. Levels 1–10 keep PR #20's teaching order: ordinary matches, then single-layer ice at 3, two-layer ice at 5, traps at 7, collection at 9. A level asking two kinds of objective at once asks less of each.

Layouts are procedural: eight shape families placed by a generator seeded from the level number alone. A level's layout is therefore identical for everyone, as the daily competition needs, but no longer visibly repeats every four levels as v2's four hand-written patterns did. Traps never sit in the top two rows, so there is always room above for a rescue swap.

### The end-of-level bonus

When the level is won, every move the player did not need fires a striped crystal — picked from the run's own seeded generator, so a replay reproduces every point of it — and then anything still special on the board goes off, behind a `BONUS!` flourish at four tenths of normal wave time. This is what makes winning efficiently beat farming points. Measured over 300 chained runs: the smart bot now scores 218,820 a run against the greedy bot's 171,009, where on v2 greedy out-scored smart 121,687 to 101,598.

### Six colours

v2 opened on four colours and grew to seven. v3 uses six at every level. With specials firing, four colours turn the board into a self-sustaining chain reaction — a single measured move earned 7,000 points over 57 seconds. Six also separates skill best: a smart bot out-scores a random one 2.0× at six colours and only 1.5× at seven, which is most of the win-rate spread the curve needs. White is left to the colour bomb alone.

### The curve, solved rather than guessed

`tools/sequence-levels.mjs` drives the real engine with three bots (`random`, `greedy`, `smart`) and reports a per-level table, chained-run lengths and the win-rate targets. The score goals in `V3_TUNING` were found by bisecting the goal that gives a wanted bot win rate at each checkpoint; the per-plan weights were then moved until every objective mix lands at the same difficulty. Score-only and `ice+traps` levels turn out to be the *hardest* plans once a good player handles their objectives, which is the opposite of how it looks.

Measured at 300 seeds a level:

| Level | random | greedy | smart |
| --- | --- | --- | --- |
| 1 | 91% | 100% | 100% |
| 2 | 86% | 100% | 100% |
| 5 | 57% | 75% | 97% |
| 10 | 8% | 79% | 88% |
| 20 | 4% | 60% | 61% |
| 30 | 1% | 53% | 52% |
| 60 | 2% | 37% | 45% |
| 100 | 1% | 34% | 42% |

Levels reached per chained run (level 1 upward until the first failure): random median 5, greedy 10, smart 12. Smart stays above 20% at every level from 1 to 100 (`node tools/sequence-levels.mjs --sweep 100 --seeds 100`).

`tools/sequence-levels-baseline-v2.txt` is the same measurement taken on v2, kept for comparison. `tools/sequence-balance.mjs` is the older v1 score-target script and is unchanged.

## Version 2 (PR #20)

Levels 1–2 teach ordinary matches. Level 3 introduces four single ice layers; matching on or orthogonally beside ice removes one layer per cascade wave, and multiple neighbouring matches in one wave cannot remove two layers at once. Level 5 introduces two-layer ice, with the remaining count drawn on each frozen tile. Level 7 introduces traps: a trapped crystal cannot be swapped and anchors its column until a match on or beside it breaks the trap, and refills settle separately above and below it. Level 9 adds a collection target, counting matched crystals of the pictured type only.

Pocket, cross, diamond and corner layouts rotate. Ice tiles grow from 4 to 8; traps from 2 to 4; collection quotas from 9 to 18. Palette growth is 4–7 colours. The v2 point goal caps at 4,500.

## Replay compatibility

`sequence-progression.js` owns v2's deterministic obstacle layouts, objective transitions, legal swaps and anchored gravity; `sequence-v3.js` owns v3's. New replays are version 3; versions 1 and 2 still use their exact historical rules and random draw order.

The server namespaces courses per rules version — `sequence` for v1, `sequence-v2`, `sequence-v3` — and reads a run's rules back from the seed it was started with, newest first. A run already in flight therefore keeps the engine it began on, and a new run cannot submit an easier v1 or v2 replay. No database migration is needed.

Unchanged and depended on by the leaderboard: the replay shape `{v, game, seed, level, step, moves: [[tick, from, to]], endTick}` with length-three integer triples, `SIM_STEP` of 1/120, the 7×7 board, every random draw coming from the run's generator in the engine's order, zero refused inputs on replay, scores as non-negative integers in multiples of 50, and the 400 KB replay and elapsed-time limits. A worst-case v3 replay measures 967 bytes and 31 seconds of game time.

## Verification

- 200 Node tests, 199 passing. The one failure is the pre-existing Windows-only dev-server case from #19, which fails the same way on `main`.
- `tests/sequence-v3.test.js` covers every special and combo by the shape it clears and by scoring above its parts, chain reactions, objective counting, bomb swaps as legal moves, the deterministic end bonus, the plan rotation and layout variety, a 500-seed v3 fuzz with per-step invariants, 60 specials-seeking runs whose swaps the replay refuses none of, v1/v2/v3 replay round trips, and that no level from 1 to 100 is beyond the smart bot.
- `tests/sequence-progression.test.js` is v2's own file and pins `rulesVersion: 2`; the competition tests cover a v3 start, refusing a v1 and a v2 downgrade, and a run already on the v2 course keeping the v2 engine and course.

Run browser regression checks against the local account-enabled preview with `PH_PLAYWRIGHT_MODULE=/path/to/playwright node tools/sequence-progression-ui.cjs`; set `PH_WEBKIT=1` for WebKit. This harness stubs only the guest RNG seed, never game state or outcomes.

**Not yet done: a phone test.** The feel work (forced haptics on every cascade wave, the new select and bounce-back taps, the rising cascade pitch, the firing effects and the `BONUS!` flourish) has only been checked headlessly and in code. It needs a real device.
