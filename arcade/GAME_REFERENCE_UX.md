# Client game reference implementation

This document scopes the October 14 client PNG and motion references to the production V2 Peak Blocks, Ridge Run and Sequence screens. It supplements the incumbent nine-game `DESIGN.md`; the existing identity and unrelated menu system remain unchanged. The user confirmed that purchasing stays a prototype simulation.

## Visual system

The original crystal-cave, alpine-sunrise and brass crystal-laboratory backgrounds remain in use. Live HTML/canvas owns boards, HUD values, statistics, actions and balances. New transparent raster mascot, wordmarks and blue coin atlas supply the missing illustrated materials. Adjacent asset JSON files and embedded provenance retain the exact generation prompt and derivation.

| Surface | Observed value or behavior |
| --- | --- |
| Arena | Centered portrait column, maximum 480px; iframe spans the viewport so desktop dialogs can extend outside it |
| Gutters | 20px; 18px at 420px and below; 16px at 370px and below |
| Result dialog | Maximum 380px width; 24px corners; cyan rim; navy `#06264ec4` with 8px internal backdrop blur |
| Shop dialog | Snowy white surface; desktop breakpoint 760px; maximum width 720px Blocks, 620px Ridge, 660px Sequence |
| Dialog safety | Maximum viewport height minus 40px (32px on narrow phones), internal scroll, no horizontal overflow |
| Type | Locally hosted Inter for live copy; raster ice wordmarks for Blocks/Ridge; live Sequence level label |
| HUD | Three glossy cyan/blue metrics, 64px minimum card height; tabular values scale by digit count; values above 10,000 use compact notation with full accessible label |
| Controls | At least 44px targets; blue retry CTA 64px, secondary 48px; close 44px |
| Focus | Gold 3px outline, 4px offset |
| Motion | Result entrance 260ms, `cubic-bezier(.16,1,.3,1)`; respects device preference and saved decorative-motion setting |

Blue results show actual final statistics above retry, ranks and exit actions. The frozen live board remains underneath. Sequence places its shared-coin count and overlapping coin cluster at the upper right beside the mascot.

Desktop white shops pair run statistics with selectable packs. Blocks uses four packs across. Ridge uses two columns with horizontal quantity/art on desktop and vertical quantity, unit, coin art and price on mobile. Sequence uses two columns with vertical contents on desktop and four packs across on mobile. These bounded viewport adaptations preserve the spacing and touch-target guidelines; short devices scroll rather than compressing controls. Small pack-unit/prototype captions are auxiliary labels, not a general body-text scale.

## Prototype play credits

`dist/play-credits.js` owns `ph-arcade-play-credits-v1`: three free launches per game per local calendar day, plus one shared blue-coin balance across all three games. Both initial launch and result replay consume a play. Remaining free launches are used first, then one blue coin. Day rollover restores free launches and retains shared coins. Existing V2 daily usage migrates without returning already spent plays.

Blue play credits are separate from cosmetic/reward coins under `ph-arcade-v1`. The reference packs are 1/A$2.99, 5/A$9.99, 10/A$17.99 and 25/A$29.99, with 10 initially selected. Every price carries an adjacent Prototype label. Selection and confirmation simulate adding coins locally; no checkout, payment request or charge occurs. A purchase is saved before replay, then the new run consumes a play normally. Storage failure gives feedback and prevents an unsaved launch/purchase from appearing successful.

Sequence retries a failed level with a fresh board and advances after an actual win. Existing target rules, seeded engine logic, finite tools, sound, personal bests, Ridge course and pause/resume behavior remain authoritative. Ranks buttons open the existing Arcade Ranks page; they do not introduce a separate per-game backend leaderboard.

## Validation and scope

The build validates JavaScript syntax and local imports. The full game suite passes 118 tests. Browser checks cover real placement/scoring, frozen boards, free and paid replays, empty-wallet shop, simulated purchase persistence, ranks/exit and no page errors. Twenty-seven captures cover all three games in gameplay/result/shop at 390×844, 1440×900 and 320×568, with no horizontal overflow or HTTP errors. Motion previews supplied by the client use the same worlds and mostly static gameplay composition. Fixture screenshot scores demonstrate the reference states; production values come from live game results.

The fresh review identified six material fixes, all scored resolved in the final fallback verdict: HUD truncation, Sequence wallet composition, Ridge mobile pack hierarchy, Sequence desktop pack hierarchy, result translucency and adjacent prototype price disclosure. The independent continuation and documenter hit a provider usage limit; final verdict and documentation checks were completed in-thread and recorded with that limitation.

Root `PRODUCT.md`, `DESIGN.md` and `.impeccable/design.json` describe the older nine-game Alpine Lab app. Their menu and white-sheet restrictions predate the user-pinned V2 client references. They were preserved; this scoped supplement records the approved result/shop variants without turning old menu drift or tiny auxiliary captions into global rules.
