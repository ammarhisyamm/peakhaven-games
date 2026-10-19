# Client playtest changes — 19 October 2026

Applies to production Peak Blocks, Sequence and Ridge Run, on top of main f28be2f. The current three-game app, English UI, 480px arena, 20/18/16px gutters, saved sound/motion preferences and ranked replay verification remain the implementation context. No generated raster asset was necessary: the existing PH crystal sprite supplies consistent tiles; the flight crystal and moving colour field are native canvas graphics.

## Peak Blocks

- Retains the existing pick/place/clear recordings and valid-placement/line-clear preview and Hint mechanics.
- Audio now waits for a suspended/interrupted mobile AudioContext to resume, retries activation in each new user gesture, recovers after a closed context and uses a same-context synth if a sample fails or takes over 90ms. Muting, leaving and hiding the page invalidate pending cues; decoded samples remain cached. Undo uses the descending whoosh; Shuffle uses a separate swish sample.
- A blocked hand gets a persistent, large `No pieces fit` notice beside the tool dock, with the usable rescue tools outlined. Their brief attention animation runs three times and is static with reduced motion. Hint is not falsely advertised as a way to clear an already blocked board.
- Bomb can be dragged like a piece or selected then applied with a tap/keyboard. The full 3×3 footprint and its centre are visible; the active tool and a persistent instruction identify bomb mode. Touch lifts the preview above the finger. Invalid drops, cancellation, blur and pause do not spend a use; pause cancels targeting.
- Shuffle animates all three new pieces for 240ms with a short stagger. This is visual only and does not change deal randomness or replays.
- All six dealt block colours (1,2,3,7,8,9) use the same official PH emblem from the original tile artwork. Tint changes preserve colour families. Hand pieces keep a consistent scale without changing tray height.
- The crystal background is blurred/desaturated behind a navy tint. The board, tool labels and status are on legible backing.

## Sequence

- Keeps idle hints, v3 specials, ice, locks, collection rules and the existing level curve.
- The three HUD values are now Score, Moves and Level. A separate readable goal group shows actual score/ice/lock/collection progress instead of fine print crammed into one row. Long point totals use compact visible notation with exact accessible values.
- Goals are two columns on regular screens and a compact three-column group on short phones to preserve board size. The live board fits between the measured goals and obstacle guide; cells remain square and input/replay indices are unchanged.
- Ice has one visible rim per remaining hit, including three-layer ice. Tiny numeric badges were removed. Traps are recognisable gold padlocks, replacing the two gold prison bars and full gold cage.
- A locked selection explains that a neighbouring match opens the padlock and consumes no move. In-board guidance explains ice and locks. `How to play` opens the pause/instructions flow; instructions use the current level goals rather than the old blanket 25-move description.
- A subdued navy environment fills the screen; the distracting brass workshop is a faint blurred layer. No white bands surround the board.

## Ridge Run

- Preserves the proportional vial gates and glass collision profile. The controlled object is now a round PH flight crystal; its visible circular edge corresponds to the forgiving radius-13 circular hitbox rather than a taller vial sprite.
- A live, minimal colour field with faint passing streaks replaces the detailed scenery. Decorative motion switches off with the existing preferences.
- Colour regions change every 50 **gates**, with a named region, live checkpoint progress and a brief milestone cue. Regions are Blue, Violet, Emerald, Amber, Rose and Indigo, then repeat.
- Each of the first six 50-gate checkpoints adds 12% to the base speed and removes 8 world units from the opening; the late-game curve caps at a 1.72 multiplier and an opening no smaller than 130. Every opening keeps its spawn-time geometry. This adds clear harder checkpoints while keeping a playable ceiling.
- Every new run has one optional free revive. The crash pauses for the decision; Revive preserves the earned score, centres the crystal in the next safe opening, waits for an intentional tap and supplies 1.25 seconds of shield after play resumes. It spends no coin or extra run. Finish declines; a second crash finishes normally.
- Ridge v6 logs the revive tick. The server independently replays it, refuses extra/early revives and binds new runs to the `ridge-v6` seed namespace so they cannot submit an easier legacy course. In-flight v4/v5 runs retain their original namespace and verification. No database migration or extra serverless endpoint is needed.

## Validation

- `npm test`: **278 passed, 0 failed**, covering rules, replays, accounts, payments, admin, Sequence and regressions.
- New audio tests exercise delayed resume, interruption, failed/slow downloads, muted queues and closed contexts.
- New Ridge tests exercise milestone boundaries, bounded difficulty, single revive/second crash, replay parity, forged revives and legacy downgrade rejection. Reachability is carried through 350 gates for 24 seeds (all six difficulty steps).
- `tools/client-feedback-ui.cjs`: **Chromium and WebKit passed**, with real blocked-hand recovery, nine-cell bomb drop with exact clearing, invalid/cancelled mouse and touch gestures, shuffle motion, pause, instructions and a real ranked iframe revive → server-verified result.
- Visual comparison: desktop 1440×1000, mobile 390×844 and small phone 320×568, including short-screen goal layout, bomb targeting and revive. Review files are written outside the repository to `/tmp/ph-feedback-review`.
