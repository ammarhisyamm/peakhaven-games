---
version: 1
slug: "game-client-reference-20261014"
primary_target: "arcade/ui/game/reference-results.js"
related_targets: ["arcade/ui/game/reference-results.css", "arcade/ui/game/arcade-overrides.css", "arcade/ui/game/app.js", "arcade/ui/app.js", "dist/play-credits.js", "arcade/GAME_REFERENCE_UX.md"]
---
# October 14 client game references

Scope: production V2 gameplay for Peak Blocks, Ridge Run and Sequence. Ordinary extension of the existing PH worlds; client PNGs and MP4s in `/Users/mac/Downloads/PH Arcade UX/` govern these three result/shop surfaces. Older nine-game menu guidelines remain scoped to their own app.

Mode: Operate. The player reads real run state, starts another run, manages prototype play credits, or returns to Arcade/ranks. The existing client worlds and the user's prototype-purchase decision supply the visual and product authority.

## Direction contract

THESIS: Carry the client’s crystalline gameplay into responsive result and shared-coin panels, preserving real board state beneath the interface.
OWN-WORLD: Existing blue crystal cave, alpine sunrise and brass crystal laboratory backgrounds; cyan glass HUDs, ice wordmarks, silver-capped mascot, blue play coins, navy translucent results and snowy white coin shops.
STORY: Play, read actual run statistics, retry using a remaining free play or one shared coin, inspect ranks or return to Arcade. Purchases remain explicitly labeled prototype simulations.
FIRST VIEWPORT: Back control and three HUD metrics sit above the live arena. A centered blue result overlays the preserved board; Sequence’s wallet sits at its upper right beside the mascot. Desktop white shops pair run summary with packs; mobile Blocks/Sequence packs run four across and Ridge packs use two columns. Keep the established 20/18/16px gutters, a 480px arena cap, 44px controls and scrollable short-screen panels.
FORM: User-pinned references, code-led adaptation; generated mascot/coin/wordmark assets fill missing materials. Existing game mechanics, seeded Sequence rules and Ridge course remain authoritative.
FINISH: Reviewed implementation, a comparison verdict and scoped `arcade/GAME_REFERENCE_UX.md`; preserve incumbent root `DESIGN.md` and `.impeccable/design.json`. Every shipping generated raster carries adjacent provenance.

## Evidence

Reference motion MP4 contact sheets are under `/tmp/ph-motion-review/`; they show the same existing worlds and mostly static gameplay composition. Screenshots and browser checks are under `.impeccable/review/game-reference/`. Existing DESIGN.md is retained because this is an ordinary extension; scoped design documentation records the client-approved result/shop variants.

## Documentation comparison

`arcade/GAME_REFERENCE_UX.md` records the implemented colors, type, gutters, 480px arena, 380px result cap, 760px desktop shop breakpoint, short-screen scrolling, counted replays and shared-credit simulation. Source and browser-flow evidence agree on this scoped behavior. Root design guidance still supplies the bottle identity, live-state/art separation, gold focus and motion preferences. The white coin shop and Inter result headings are local client-reference variants, not a new global world.

Pre-existing drift is reported without repair: the older Sites surface brief still describes five games while PRODUCT.md/root DESIGN.md describe the later nine-game app; its primary target is a legacy Sites path. The root sidecar is dated October 11 and contains incumbent five-tab/console components rather than these production V2 result/shop variants. Root PRODUCT.md's prototype cosmetic-coin retry language belongs to that older app; these three production games consume free launches or shared blue play credits. No global artifacts were rewritten.

## Finish record

All six material findings resolved in `.impeccable/review/game-reference/final-verdict.md`. Independent continuation/documenter were unavailable due to provider usage limits; fallback scoring and documentation completed in-thread. Incumbent DESIGN.md/sidecar retained; `arcade/GAME_REFERENCE_UX.md` records the scoped client variants and `arcade/README.md` describes current credit behavior. All five new shipping raster materials carry embedded and adjacent provenance.
