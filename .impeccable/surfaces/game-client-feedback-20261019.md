---
version: 1
slug: "game-client-feedback-20261019"
primary_target: "arcade/ui/game/feedback-ui.js"
related_targets: ["arcade/ui/game/app.js", "arcade/ui/game/arcade-overrides.css", "dist/puzzle-games.js", "dist/game-audio.js", "dist/tryout-games.js", "dist/ridge-progression.js"]
---
# Client playtest, 19 October

Mode: Operate. Improve the current three production games for the client’s older audience: legible goals and recovery actions, unambiguous bomb/obstacle states, reliable optional audio and readable playfields. The user explicitly requests calmer game environments, a new controlled Ridge object, colour/difficulty checkpoints and a correctly implemented revive.

Preserve the PH emblem, cyan glass HUD, colourful crystalline board pieces, existing positive placement/clear/hint feedback, full mobile game surface, 480px arena and 20/18/16px gutters. Generated raster artwork is not required: existing PH tile detail is reused with consistent tints, and the Ridge flight crystal/colour field are drawn natively. Muted wallpaper is intentional client feedback, scoped to these games. Older menu and result/shop references remain scoped to their own surfaces.

Recovery is visible near the controls, never hidden in the small bottom status alone. Bomb uses a lifted preview and a complete impact footprint. Sequence prioritises score, moves, level and goal progress, with recognisable padlocks and countable ice rims. Ridge colour regions progress at 50-gate checkpoints and its one free revive is part of the real verified run.

`arcade/CLIENT_PLAYTEST_20261019.md` maps every comment to its implementation and validation. The source diff preserves other app flows and adds no database migration or serverless endpoint.
