---
version: 1
slug: "sites-peak-haven-arcade-dist-index-html"
primary_target: "sites/peak-haven-arcade/dist/index.html"
related_targets: ["sites/peak-haven-arcade/dist/world-ui.css", "sites/peak-haven-arcade/dist/app.js"]
---
# PH Arcade Alpine Lab redesign

Mode: Experience. Implemented menu redesign across the existing five-game application. The user delegated design judgment and authorized guidelines and implementation across all menus. Preserve PH identity, mechanics, device saves, sound, prototype retry and the inset navy navbar. This brief supersedes the former horizontal shelf, white sheet and rotating mission-map compositions.

## Direction contract

THESIS: An alpine bottle laboratory where choosing a game means approaching a real display and claiming a reward means opening the treasury.
OWN-WORLD: Chrome/cobalt control consoles with navy reading faces; cyan glass bottle pedestals; gold treasury trays; archive racks and player terminals. White PH Arcade lockup and official symbol, separate happy glass bottle mascot, proportional short vials, Anybody display and Inter reading type. Illustrated environments contain no live labels or controls.
STORY: Choose one of five games; clear Sort or Mahjong levels, or set a Tower/Merge/Blocks personal best; earn local XP/coins/gems; claim a daily chest and free spin; collect and equip six Tower bottles; inspect actual local profile statistics. Existing saves stay compatible.
FIRST VIEWPORT: A relative compact header above a separate stationary mascot and actual Play Now. Three-column game/pedestal displays include all five games and a daily reward object, followed by a daily challenge console. The full chooser uses two columns. Arcade uses two puzzle tabs and a physical level console; endless records follow. Rewards opens with a daily chest in gold furniture. Bottles uses an equipped display and six-vial rack. Profile uses an attached avatar/player terminal, stats, rack and achievement tray, with no Your Games shelf.
FORM: User-pinned PH Arcade identity expressed through the Alpine Lab world. Source order is styles.css then world-ui.css; the latter supplies the final layout/material cascade. Seed identity remains user-ph-bottle-world-20261010; this is its approved menu evolution.
FINISH: Reviewed implementation, current DESIGN.md/sidecar and product/guideline record; shipping generated raster materials retain adjacent provenance.

## Camera and responsive expression

Central sharp art is absolute within the document and shares scrolling with all scene objects and UI. It remains a centered 480px portrait world. Fixed peripheral scenery is blurred/dimmed; the fixed gradient supports readability. No ornamental target parallax. Menus reserve 112px plus the bottom safe area for the preserved inset navbar. Normal gutters are 16px and narrow gutters 12px; level nodes remain circular, and long profile names move to a full-width second row at 370px and narrower. Gameplay has a stable document camera with proportional boards and its essential internal game movement.

## Physical components

console-frame.webp uses a 23px nine-slice border with 19%/13%/23%/13% fill slices. treasury-frame.webp uses its gold material with 25px border-image width. Slim consoles reduce chrome width to 17px. vial-pedestal.webp sits beneath game objects and equipped/archived bottles; live navy plaques own their names. The home-lobby.webp terrace supplies open environment space around the separate mascot and displays. Each new asset has a .webp.json record with its source, hash, prompt and derivation.

The icon file names are legacy labels: Vial Tower deliberately maps to game-icons/merge.png (the stacked bottles), and Vial Merge maps to game-icons/tower.png (the swirling bottles). Preserve the semantic mapping rather than swapping to match filenames.

## Interaction invariants

New actions have 44px minimum targets, proportional fixed-square icons, live selection state, gold keyboard focus and polite feedback. Text and buttons are never part of scene art. Sort/Mahjong unlock levels from actual wins; Tower/Merge/Blocks expose endless high scores. Loading has real progress/cancel/retry; the prototype coin retry is preserved. The motion setting and reduced-motion preference govern decoration, and every game retains saved optional sound. UI furniture does not change mechanics.

## Review interpretation

Read review captures under .impeccable/review/ as evidence, not design authority over the implemented cascade. The initial review corrections include truthful game-icon mapping, removal of Profile Your Games, full-width compact player names and navy-backed Tower instructions. Detector palette/type advisories reflect the new material/UI cascade; the detector was run once. Tiny inherited auxiliary captions are not a new body-text standard. Material meniscus/specular strips, reveal lighting and functional dialog/toast depth remain contextual effects; the retired shell shadow is overridden.
