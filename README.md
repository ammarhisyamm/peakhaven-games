# PH Arcade

A mobile browser game built from the user's latest PH Arcade reference boards. Buildless HTML, CSS and JavaScript in `dist/`; the existing Next application serves a mirrored copy at `/arcade`.

## Run and verify

`npm run preview` serves http://localhost:8765. `npm test` runs 20 engine, block/mahjong puzzle, progression and collection/economy tests. No package installation or framework build is needed for the static Site.

## Play

Home discovers Vial Tower, Vial Merge, Lab Sort, Peak Blocks and Bottle Mahjong. Arcade has 18 sequential missions in three chapters. Select a numbered platform, then PLAY. Tutorials, pause/resume, instructions, win/retry and next-level actions are included. Free play is available from the Home shelf and See All.

Tower has an alignment cue, slight landing assistance, particles, shockwaves and perfect combos. Merge uses collision simulation, matching tiers and chains. Sort has reversible pours, hints, an animated liquid stream and no timer. Space/Enter drops; Merge arrow keys aim; Escape pauses. Peak Blocks offers an 8×8 board, three-piece tray, simultaneous row/column clears and three uses each of Bomb, Undo, Shuffle and Hint. Bottle Mahjong has 34 layered tiles, legal exposed-pair matching, solvable deals and three uses each of Hint, Undo and Shuffle. Block cells support arrow keys and Enter. Native buttons support Tab/Enter. Hidden browser tabs pause games. Every entry preloads required art with actual progress, cancellation and retry before showing the playable board.

## Progress and collectibles

Existing `ph-arcade-v1` saves migrate without losing XP, missions, best scores or badges. XP advances the player level every 150 points. Clearing a puzzle level (Sort, Mahjong, Sequence) for the first time awards 25 XP, 20 coins and one gem; replays award 5 XP and 20 coins. A failed puzzle level awards nothing. Endless runs (Tower, Merge, Blocks, Orbit, Ridge Run, Bond) award 5 to 30 coins by score plus 5 XP. The five-game boost doubles the coins from any game that pays coins. Retrying from the result screen costs 50 coins, taken once the game has loaded; the prototype top-up adds only the coins needed.

Rewards include one daily chest, one free daily spin, a five-game coin boost, badges and a calendar. Daily chests start at 50 coins, add 10 per consecutive claim up to 110, and award one gem plus 10 XP. Daily merge challenge awards 40 coins once after 10 merges; stacking 10 Tower vials earns its badge separately. Six skins unlock through XP, mission completion, streaks or game currency. Equipped skin appears in Tower. All currency is local, with no real-money purchases or cash value. Profile shows real device stats and an editable local nickname.

## Art and typography

Thirteen Imagegen deliverables across the branding and gameplay updates: white PH Arcade logo, cheerful bottle mascot, alpine vial castle world, three game covers, six collectible vial variants and reward chest; plus alpine Tower, botanical glasshouse and crystal cave scene plates, six happy coloured vials and a five-part crystal/ceramic tile sheet; plus transparent cylindrical Sort glass and a chrome/glass Merge chamber frame. WebP files preserve native proportions and transparency. Source prompts, original paths and references are in `asset-prompts.json`; each generated shipping raster has embedded provenance and a JSON sidecar. Original Peak Haven symbol remains available in assets.

The user pinned Monument Extended and Inter. Inter is self-hosted; open-license Anybody is the extended geometric display substitute because a Monument Extended font file/license was not supplied. The build follows the reference layouts/materials while using actual game content, unified five-tab navigation and real local values. It is not certified as a pixel-identical copy of the mockups.

## Accessibility and deployment

Reduced decorative motion follows both device preference and the saved setting; essential gameplay movement stays available. Sound starts on after the first tap and can be switched off in Settings or Pause. Progress stays on this browser with no customer account. The existing hosted Site remains owner-private and its platform access requires ChatGPT sign-in.

The Sites helper packages `dist/` plus `.openai/hosting.json` and deploys the pushed source commit. No Next build is part of this independent static release.

## Replays and anti-cheat (Peak Blocks, Ridge Run, Vial Merge, Bond)

These games are seeded and step on a fixed 1/120 s clock, so a run is fully determined by its seed and inputs. Each finished run's result includes a `replay` record (seed plus input log). `tools/replay.mjs` re-plays a record headless in Node and returns the score it really earned. A future leaderboard should accept a score only if its replay reproduces it; anything kept in the browser alone can still be edited. `npm test` covers stuck boards, undo re-rolls, gate reachability on several screen sizes, frame-rate independence and replay accuracy.
