# Sequence progression

New games use rules version 2. The 7×7 crystal board, 25 successful swaps, no-cost invalid swaps and seeded scoring remain. Clear the score goal **and every objective** to advance. A failed level ends the ranked run; cleared levels keep the same run and add their verified scores.

- Levels 1–2 teach ordinary matches.
- Level 3 introduces four single ice layers. Matching on or orthogonally beside ice removes one layer per cascade wave. Multiple neighbouring matches in one wave cannot remove two layers at once.
- Level 5 introduces two-layer ice. The remaining layer count is drawn on each frozen tile.
- Level 7 introduces traps. A trapped crystal cannot be swapped and anchors its column until a match on or beside it breaks the trap. Refills settle separately above/below it. A direct match can clear the trapped crystal when freeing it.
- Level 9 adds a collection target. Only matched crystals of the pictured type count; adjacent hits never collect a crystal.

Pocket, cross, diamond and corner layouts rotate. Ice tiles grow from 4 to 8; traps grow from 2 to 4; collection quotas grow from 9 to 18. Palette growth remains 4–7 colours. The v2 point goal caps at 4,500 because later levels also require all three objective types. This keeps late levels challenging without an endlessly increasing, unreachable score target.

The live objective strip and result panel show real progress. Dead boards reshuffle without spending moves, removing ice or traps, collecting crystals or moving still-trapped crystals. A bounded fallback keeps the upper two rows available for a rescue match. Pausing, cancelling gestures and invalid input never progress objectives.

## Replay compatibility

`sequence-progression.js` owns deterministic obstacle layouts, objective transitions, legal swaps and anchored gravity. New replays are version 2; version 1 still uses the exact historical rules and random draw order. The server namespaces new Sequence courses as `sequence-v2` and recognises the rules from the stored first seed, so a new run cannot submit an easier v1 replay. Old in-flight runs keep their original course seeds and v1 engine through subsequent levels. No database migration is needed.

## Verification

- 171 Node tests, including 200 complete v2 runs with state invariants and 50 server replay round trips, plus the retained v1 fuzz/replay fixtures.
- Introduction, ice double-hit/deduplication, trap input/gravity/release, collection counting, all-goal win gating, no-move loss, objective-preserving dead-board rescue, constant-generator fallback and server downgrade rejection.
- A visible-objective bot across 60 seeds per checkpoint: 100% clears at levels 1/3/5/7/9/12, 95% at 16, 90% at 20, 72% at 30, 60% at 50 and 65% at 100. It evaluates visible matches, never future random refills. These are calibration samples, not human completion-rate promises.

- Chrome and WebKit: objective/render checks at desktop, 390px and 320px; a real canvas-tap playthrough clears all Level 9 goals and opens Level 10. The short-screen result fits/scrolls at 320×568.
- Existing 13-group Chrome audit passes, including all three games, offline/retry paths, score recovery and a server-verified Sequence win/next level in the same run.

Run browser regression checks against the local account-enabled preview with `PH_PLAYWRIGHT_MODULE=/path/to/playwright node tools/sequence-progression-ui.cjs`; set `PH_WEBKIT=1` for WebKit. This harness stubs only the guest RNG seed, never game state or outcomes.
