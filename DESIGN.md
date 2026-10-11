---
name: "Peak Haven Arcade"
description: "Alpine Lab: physical bottle displays and live local games in a continuous illustrated world."
colors:
  ink: "#0a1b3d"
  muted: "#506a96"
  blue: "#0ea5ff"
  sky: "#38bdf8"
  ice: "#e6f4ff"
  gold: "#ffd24d"
  white: "#f8fafc"
  pure-white: "#ffffff"
  world-navy: "#041d4c"
  scene-copy: "#f4fcff"
  scene-muted: "#cceaff"
  console-navy: "#061e45"
  display-navy: "#031a3dec"
  category-navy: "#052959ed"
  category-copy: "#d6f3ff"
  category-rim: "#7ccfff6b"
  category-cyan: "#00cffa"
  category-blue: "#0878ef"
  category-active-rim: "#b6f8ff"
  world-control-cyan: "#00e0ff"
  world-control-blue: "#039fff"
  world-control-base: "#0061ff"
  world-control-rim: "#d5ebff"
  world-secondary-top: "#145b9b"
  world-secondary-base: "#0b2e65"
  secondary-rim: "#8dc9f4"
  claim-top: "#ffe776"
  claim-mid: "#ffce38"
  claim-base: "#ffaa00"
  claim-ink: "#102852"
  claim-rim: "#fff3ab"
  disabled-top: "#577b9d"
  disabled-base: "#2c4b72"
  disabled-copy: "#d0e2f1"
  disabled-rim: "#7fa9ce"
  nav-pill: "#0c2a5bfa"
  nav-base: "#071b40fa"
  nav-rim: "#7dbcfb55"
  nav-label-muted: "#9aaccb"
  nav-active-blue: "#0b3978"
  nav-active-base: "#082451"
  nav-cyan: "#08c7ff"
  nav-icon-cyan: "#72ecff"
  hud-cyan: "#22e1f1"
  hud-blue: "#078ef0"
  hud-deep-blue: "#0755dc"
  hud-rim: "#bceeff"
  hud-label: "#ecfcff"
  hud-star: "#ffdf69"
  liquid-cyan: "#08bffc"
  liquid-pink: "#fa35b6"
  liquid-gold: "#ffd325"
  liquid-purple: "#a63eff"
  liquid-green: "#20cf7d"
  liquid-blue: "#3572ff"
typography:
  headline:
    fontFamily: "Anybody, Inter, sans-serif"
    fontSize: "30px"
    fontWeight: 850
    lineHeight: 1.05
    letterSpacing: "-.025em"
    fontVariation: "'wdth' 115"
  page-title:
    fontFamily: "Anybody, Inter, sans-serif"
    fontSize: "25px"
    fontWeight: 850
    lineHeight: 1.15
    letterSpacing: "-.025em"
    fontVariation: "'wdth' 115"
  game-title:
    fontFamily: "Anybody, Inter, sans-serif"
    fontSize: "clamp(20px,5.7vw,27px)"
    fontWeight: 850
    lineHeight: 1.1
    letterSpacing: "-.04em"
    fontVariation: "'wdth' 115"
  section-title:
    fontFamily: "Anybody, Inter, sans-serif"
    fontSize: "20px"
    fontWeight: 850
    lineHeight: 1.2
    letterSpacing: "-.025em"
    fontVariation: "'wdth' 115"
  display-label:
    fontFamily: "Inter, sans-serif"
    fontSize: "12px"
    fontWeight: 850
    lineHeight: 1.25
  picker-label:
    fontFamily: "Inter, sans-serif"
    fontSize: "15px"
    fontWeight: 850
    lineHeight: 1.25
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
  description:
    fontFamily: "Inter, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
  game-status:
    fontFamily: "Inter, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "17px"
    fontWeight: 850
    lineHeight: 1.4
  launch-label:
    fontFamily: "Inter, sans-serif"
    fontSize: "21px"
    fontWeight: 850
    lineHeight: 1.4
  nav-label:
    fontFamily: "Inter, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.4
  nav-label-compact:
    fontFamily: "Inter, sans-serif"
    fontSize: "9px"
    fontWeight: 700
    lineHeight: 1.4
  hud-value:
    fontFamily: "Inter, sans-serif"
    fontSize: "clamp(13px,calc(34px - var(--digits,1)*3px),29px)"
    fontWeight: 900
    lineHeight: 1.12
  hud-label:
    fontFamily: "Inter, sans-serif"
    fontSize: "clamp(9px,2.8vw,11px)"
    fontWeight: 850
    lineHeight: 1.4
    letterSpacing: ".45px"
rounded:
  cell: "6px"
  display-label: "8px"
  game-message: "10px"
  field: "12px"
  tool: "14px"
  board: "17px"
  console: "20px"
  chip: "23px"
  currency: "24px"
  dialog: "27px"
  nav-pill: "28px"
  control: "30px"
  circle: "50%"
  glass-tube: "0"
  fluid-cylinder: "0 0 11px 11px"
  liquid-band: "48% / 9%"
spacing:
  micro: "3px"
  small: "5px"
  compact: "8px"
  inline: "10px"
  gap: "12px"
  game-inset: "14px"
  menu-inset: "16px"
  section-gap: "18px"
  page-inset: "20px"
  console-inset: "22px"
  dialog-inset: "24px"
components:
  button-primary:
    textColor: "{colors.pure-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "56px"
  button-secondary:
    textColor: "{colors.pure-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "56px"
  button-gold:
    textColor: "{colors.claim-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "56px"
  button-disabled:
    textColor: "{colors.disabled-copy}"
    rounded: "{rounded.control}"
  name-input:
    backgroundColor: "{colors.pure-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px"
    height: "48px"
  navigation:
    textColor: "{colors.nav-label-muted}"
    typography: "{typography.nav-label}"
    rounded: "{rounded.console}"
    height: "60px"
  navigation-active:
    textColor: "{colors.pure-white}"
    rounded: "{rounded.console}"
  category-chip:
    backgroundColor: "{colors.category-navy}"
    textColor: "{colors.category-copy}"
    rounded: "{rounded.chip}"
    padding: "9px 7px"
    height: "44px"
  lab-console:
    textColor: "{colors.scene-copy}"
    rounded: "{rounded.console}"
    padding: "22px"
  game-display:
    textColor: "{colors.pure-white}"
    height: "150px"
  game-hud:
    textColor: "{colors.pure-white}"
    rounded: "{rounded.console}"
    padding: "8px 7px"
    height: "64px"
  sort-tube:
    rounded: "{rounded.glass-tube}"
    width: "auto"
    height: "min(180px,calc((100dvh - 438px)*.48))"
  merge-chamber:
    width: "456px"
    height: "490px"
  game-tool:
    textColor: "{colors.pure-white}"
    rounded: "{rounded.tool}"
    padding: "5px 2px"
    height: "56px"
---

# Design System: Peak Haven Arcade

## Overview

**Creative North Star: "The Alpine Lab"**

PH Arcade is a luminous alpine bottle laboratory. A happy silver-capped glass bottle companion, collectible short vials, white PH Arcade logo and official Peak Haven symbol preserve the supplied brand identity. Chrome and cobalt consoles, cyan display pedestals, gold treasury trays and bottle racks give the interface physical places for its tasks. The approved bottle identity supersedes the former robot and Nunito system.

Environment, furniture, objects and live controls form one scene. The sharp portrait environment scrolls with the document and its displays; the peripheral blurred scenery and readability gradient stay fixed. Anybody supplies wide geometric headings and Inter carries practical reading. Artwork establishes atmosphere and material; live HTML, canvas and game state own every label, action, score, liquid, unlock and reward.

**Key Characteristics:**

- A continuous illustrated world with a centered mobile content column and inset navy navigation.
- White PH Arcade identity, one separate bottle mascot and proportional game objects.
- Physical chrome consoles, cyan pedestals, gold reward trays and bottle racks.
- Navy reading surfaces, electric blue actions, cyan glass edges and gold reward or selection feedback.
- Actual local progress, keyboard states, named or numbered pieces and optional decorative motion.

## Colors

Deep navy anchors the laboratory; electric blue and cyan illuminate controls and glass, with warm gold for rewards. The frontmatter records reused values from the final stylesheet cascade. Root colors retain their source names; translucent values retain their alpha. Raster material colors are governed by the supplied assets rather than invented CSS approximations.

### Primary

- **Electric action blue:** `blue` and the `world-control-*` gradient build the main action face. The light control rim distinguishes a pressable object from the scene.
- **Glass cyan:** `sky`, category selection and navbar cyan identify active controls and material highlights. HUD cards use their own glossy cyan-to-blue gradient.

### Secondary

- **Game liquids:** the six `liquid-*` colors identify live numbered Lab Sort contents and game pieces. They remain a game-state palette rather than a general menu theme.

### Tertiary

- **Reward gold:** `gold`, the claim gradient and warm star color mark earned rewards, primary claim actions and keyboard or puzzle selection. Color always accompanies an actual label, icon or state.

### Neutral

- **Laboratory navy:** `world-navy`, `console-navy`, `display-navy` and category navy supply reading and object-label planes. Secondary controls use a dark blue gradient with white text.
- **Ice-white copy:** `scene-copy` and `scene-muted` carry text on console furniture. The white name field retains dark `ink`; its light surface is a form treatment, not a page sheet.
- **Navigation and disabled states:** muted navy-tab labels become white with a cyan active treatment. Disabled controls use a desaturated blue face and pale copy without action glow.

**The Live World Rule.** Illustration establishes the environment; game boards, scores, loading progress and earned states must be rendered from actual state.

Sidecar tonal ramps are synthesized preview metadata, not additional production colors. Single-purpose material glints and veil gradients remain snippets, not an expanded general-purpose palette.

## Typography

**Display Font:** locally hosted variable Anybody, followed by Inter and sans-serif.
**Body Font:** locally hosted variable Inter, followed by sans-serif.

Anybody with its wide axis is the established substitute for unavailable Monument Extended. Both font files declare weights 100–900 with swap loading. Broad, compact headings contrast with plain instructions and tabular statistics. The PH Arcade wordmark stays artwork.

### Hierarchy

- **Headline / page title:** the default headline remains for results and general headings; current chooser and puzzle headings use the smaller page-title role.
- **Game title / section title:** game titles respond to width; world section headings stay compact. Profile names wrap anywhere and use Anybody; at the narrow breakpoint the name occupies a full second row below the avatar and edit action.
- **Display label / picker label:** home object labels use bold Inter. The two-column chooser uses the larger picker role. These labels sit on their own navy plaque beneath proportional objects.
- **Body / description:** general interface text uses the body role; menu descriptions normally use the description role. Gameplay status has its own compact role with a navy backing.
- **Action / navigation:** primary actions use the glossy launch role; each Home game display launches that game directly. The mascot banner is illustration only. Five navigation labels remain visible at both recorded sizes.
- **HUD:** values use tabular numbers and shrink according to actual digit count. Labels use the compact responsive HUD role; neither values nor glyphs stretch to fill the card.

**The Two Voices Rule.** Use Anybody for wide display headings and Inter for practical reading. Preserve the white PH Arcade logo artwork rather than reconstructing it with text.

Existing 7–11px auxiliary calendar, achievement and stat captions are inherited density compromises, not a body-text scale to copy into new instructions.

## Layout

The live column is `width:min(100%,480px)`. Menus reserve `112px + env(safe-area-inset-bottom)` beneath content. The sharp central artwork is an absolute document layer centered at the same width, with cover sizing and top alignment. The fixed peripheral layer extends 20px beyond the viewport, blurs by 24px and dims to .55; the fixed tint maintains legibility. No decorative scroll parallax moves interactive targets. The navbar remains fixed above the safe area.

The menu header is a relative 92px row with 20px gutters, a proportional 126px brand mark, two actual wallet controls and a 44px settings action. Normal page gutters are 20px, reducing to 18px at 420px and narrower and 16px at 370px and narrower. Brand and currency dimensions reduce without distorting their icons. No breakpoint introduces a desktop sidebar or phone frame.

Reusable spatial grammar is an object display above a live navy plaque, or a framed console containing one task. Console padding is 22px; slim consoles use 16px. Home uses a three-column display grid with 16px row and 8px column gaps; the full chooser uses two columns with 24px row and 16px column gaps. Archive bottles use three columns; compact profile racks use six. Puzzle nodes use five equal columns, reducing to four at the narrow breakpoint, and remain circular. Route-specific first-viewport composition belongs in the surface brief.

Gameplay and loading omit the menu header and navigation. Gameplay keeps header, glossy three-card HUD, objective, board and control dock in one stable camera. The final game inset is 12px top, 20px sides and 20px bottom; horizontal gutters reduce to 16px below 420px and 14px below 370px. Tower and Merge retain a proportional 480:580 canvas whose width responds to remaining viewport height. Blocks has a square 8×8 board, three piece slots and a dock. Sort wraps proportional glass tubes into three or four columns; Mahjong retains a 6:5 layered board. Board dimensions respond to available height without stretching source sprites. Essential game movement and the Tower stack camera remain gameplay, not decorative page movement.

## Elevation & Depth

Depth comes from the illustrated world, raster chrome furniture and functional glass highlights. Console frames use a pseudo-element with nine-slice borders; their corners keep their material thickness while the center expands. The console uses a 23px border-image width and `19% 13% 23% 13% fill` slices. Treasury furniture uses a 25px width and `21% 14% 22% 14% fill`; slim consoles use 17px and the objective frame uses 15px. Pedestals remain separate proportional raster images beneath the game or bottle object.

### Shadow Vocabulary

- **Console contact:** `filter:drop-shadow(0 9px 9px #00102266)` on the furniture frame.
- **Displayed object contact:** `filter:drop-shadow(0 5px 4px #01234877)` on proportional game art.
- **Primary action:** `inset 0 2px 3px #fff,inset 0 -4px 8px #00258d88,0 4px 0 #0258b5,0 8px 24px #007be759`.
- **Navbar:** `0 12px 32px #00163875,inset 0 1px 0 #c4e7ff26`, with 14px backdrop blur.
- **Dialog:** `0 16px 50px #001028b3`, with 6px backdrop blur.
- **Toast:** `0 4px 20px #003b7755` for temporary feedback above the world.
- **Selected glass tube:** `filter:drop-shadow(0 0 8px #fff26b)` on the actual silhouette.
- **Liquid cylinder:** `inset 0 -4px 6px #04174233` inside the live liquid bands.

**The Material Rule.** Use rims, specular highlights, contact shadows and glow where chrome furniture, glass, selection or a primary action explains them. Keep live content separate from its material frame.

The liquid meniscus is an elliptical 7px strip; its bubble/specular layer has `inset:7px 3px 1px`. The bottle-reveal radial `#d9f5ff` is object lighting, not a page background. These material details remain intentional. The old shell shadow `#4a729b36` is overridden by the transparent shell's `box-shadow:none`; do not restore it as an Alpine Lab token.

The shipped entrance is 260ms with `cubic-bezier(.16,1,.3,1)`, control transitions are 150ms, loading interpolation is 180ms, and XP/puzzle progress is 300ms. A pedestal press translates down 2px; a primary press translates down 3px and scales to .98. Home's mascot is stationary. Both the local motion setting and system reduced-motion preference suppress decorative CSS and JavaScript effects while preserving essential game physics. Optional synthesized sound starts on by default after a player gesture and saves its preference locally.

## Shapes

Curved controls and fixed-square icons sit alongside materially specific chrome and glass. Pills, dialogs, navy plaques and tools use the frontmatter radii; raster furniture corners use nine-slice geometry rather than a stretched full-image frame. Circular buttons, avatar and level nodes retain equal width and height.

Preserve logo, mascot and game-icon proportions with contain fitting. Tower uses tight individual bottle source bounds, a logical 124×170 maximum, 164px stack spacing and a camera target holding the top bottle around y=320. Short vial atlas sprites retain a 1:2 ratio. Sort glass sits above a separate live fluid cylinder with 9% top, 10% side and 8% bottom inset; its final height is responsive up to 180px, and dense glass up to 143px. Merge's 456×490 logical chamber has no baked pieces, scores or controls.

## Components

### Buttons

Glossy cyan/blue actions, dark blue secondary actions and gold claims share the control silhouette and 56px default minimum height. Dialog and section-specific labels may use smaller type on the same target. Hover brightens enabled actions on fine pointers; press changes position and scale; disabled state removes glow. General focus is a 3px gold outline at 4px offset; puzzle selections use their own gold ring. Actions preserve a 44px minimum target; the final dialog close override is also 44×44px with a square aspect ratio.

### Chips

Three home category buttons have a dark navy face, ice-blue rim and pale label, with a cyan-to-blue selected face. Each is at least 44px tall. Actual filtering sets `aria-pressed`; main navigation remains separate.

### Cards / Containers

Task containers are physical laboratory consoles, with a gold variant for treasury tasks. A nine-slice pseudo-element owns the raster frame and navy center; semantic content sits above it. The furniture layer is inert and never owns focus. Live object displays place a proportional game icon or vial above a cyan pedestal and its separate navy name plaque. They launch the actual game or open the saved bottle state. Home and chooser use these displays instead of repeated scenic cover cards.

### Inputs / Fields

The name input remains native, white with a pale-blue stroke, dark copy, field corners, 10px padding, 16px type and 48px minimum height. Settings retain native checkboxes, labels and saved state. Native dialogs use their visible heading for the accessible name.

### Navigation

Home, Arcade, Rewards, Bottles and Profile share the established inset navy pill, 16px horizontal clearance and a safe-area-aware 12px bottom offset. Tabs are at least 60px tall. Fixed-square icons and muted inactive labels become cyan and white for the current route; `aria-current="page"` exposes selection. Gameplay and loading use their own close, help, pause and recovery controls.

### Live Gameplay and Loading

The three matching glossy stat cards retain the cyan-to-electric-blue face, pale rim, fixed-square glyph and tabular value. The final minimum card height is 64px. Tower and Merge use keyboard-enabled canvas with external HUD and status; Tower's initial instruction also has an opaque navy canvas backing. Sort exposes contents bottom-to-top, numbers, selected state, legend, Undo, Hint and Reset. Blocks retains its labeled grid, roving keyboard focus, placement previews and finite tools. Mahjong exposes tile names, layers, availability and genuine open-side matching rules. Docks hold the actual tool actions and remaining uses.

Loading reports real asset progress, supports cancel and retries asset failure. The chrome console is part of the preload, along with the game's sprites and furniture. Results show actual score, personal best, rewards and relevant next-level or coin-retry action. Local data remains under the existing browser save model; errors report feedback without blocking play. This visual record does not claim equivalent nonvisual spatial gameplay for canvas games.

All generated raster sources retain adjacent prompt/provenance records. New console, treasury, pedestal and home-lobby `.webp.json` sidecars record the source path, SHA-256, generation tool, prompt and derivation. Existing Sort glass and Merge chamber keep their separate `.provenance.json` history.

## Do's and Don'ts

### Do:

- Do preserve the 480px content column, five labeled navy tabs and safe-area spacing outside gameplay.
- Do scroll central scene art, furniture and live menu content together while the blurred perimeter and tint remain fixed.
- Do retain the white PH Arcade identity, separate bottle mascot and proportional vial/game artwork.
- Do keep console corners intact with nine-slice frames and place live objects on separate pedestals.
- Do separate generated material from all live labels, controls, liquids, game pieces, scores and rewards.
- Do distinguish bottle ownership, equipment, availability and locking from actual saved state.
- Do use Anybody for wide headings and Inter for instructions, labels and local statistics.
- Do preserve 44px action targets, gold focus, named or numbered pieces and polite feedback.
- Do respect local motion and system reduced-motion preferences while retaining game mechanics.
- Do retain real loading progress, cancel/retry and device-local save feedback.

### Don't:

- Don’t restore the robot identity, Nunito typography, white page sheets or desktop dashboard shell.
- Don’t stretch full console artwork, the logo, mascot, game icons or short vial sprites.
- Don’t bake labels, buttons, scores, board state or reward claims into scene artwork.
- Don’t introduce decorative kickers, glyph icons or hard offset type shadows as reusable house styles.
- Don’t put small instructions directly on scenery without a navy reading surface.
- Don’t move interactive targets with ornamental scroll parallax.
- Don’t promise accounts, cross-device sync, real payments or cash value for local currency.
- Don’t claim equivalent nonvisual spatial gameplay for the canvas games.
