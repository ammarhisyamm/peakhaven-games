---
name: "Peak Haven Arcade"
description: "An illustrated alpine bottle adventure with real, local casual games."
colors:
  ink: "#0a1b3d"
  muted: "#506a96"
  blue: "#0ea5ff"
  sky: "#38bdf8"
  ice: "#e6f4ff"
  gold: "#ffd24d"
  white: "#f8fafc"
  pure-white: "#ffffff"
  outer-sky: "#e6f0fa"
  shell-ice: "#eff7ff"
  panel-ice: "#f8fcff"
  panel-shade: "#edf6ff"
  world-navy: "#041d4c"
  hud-navy: "#03245dcf"
  hud-label: "#aaeaff"
  control-rim: "#94f7ff"
  secondary-ink: "#12346b"
  secondary-edge: "#bbd4f3"
  nav-ink: "#526f98"
  nav-active: "#0072ff"
  chip-ice: "#e3effc"
  chip-ink: "#173365"
  disabled-surface: "#b9cbdf"
  disabled-edge: "#d9e5f1"
  disabled-ink: "#415675"
  liquid-cyan: "#08bffc"
  liquid-pink: "#fa35b6"
  liquid-gold: "#ffd325"
  liquid-purple: "#a63eff"
  liquid-green: "#20cf7d"
  liquid-blue: "#3572ff"
  nav-pill: "#0c2a5b"
  nav-rim: "#7dbcfb"
  nav-shadow: "#001638"
  nav-highlight: "#c4e7ff"
  nav-label-muted: "#9aaccb"
  nav-active-blue: "#0b3978"
  nav-cyan: "#08c7ff"
  nav-cyan-highlight: "#7bf1ff"
  nav-active-glow: "#008dff"
  nav-icon-rim-glow: "#28b9ff"
  nav-icon-cyan: "#72ecff"
  nav-icon-glow: "#00c5ff"
  hud-rim: "#bceeff"
  hud-cyan: "#22e1f1"
  hud-blue: "#078ef0"
  hud-deep-blue: "#0755dc"
  hud-shadow: "#002c8d"
  hud-glow: "#007bd3"
  hud-glass: "#e8ffff"
  hud-star: "#ffdf69"
  hud-gold: "#ffc629"
  hud-star-rim: "#fff5a8"
  hud-icon-shadow: "#00438a"
  hud-glyph-ice: "#e2ffff"
  hud-glyph-gold: "#ffe28c"
  hud-flame: "#ff9b31"
  hud-flame-rim: "#fff0ab"
  game-tile-rim: "#c6dff6"
  game-tile-shadow: "#28648b"
  game-tile-ink: "#102e61"
  game-tile-hover: "#72d9ff"
  game-tile-hover-glow: "#087eb2"
typography:
  display:
    fontFamily: "Anybody, Inter, sans-serif"
    fontSize: "clamp(29px, 8.2vw, 35px)"
    fontWeight: 850
    lineHeight: 0.98
    letterSpacing: "-1px"
    fontVariation: "'wdth' 115"
  headline:
    fontFamily: "Anybody, Inter, sans-serif"
    fontSize: "30px"
    fontWeight: 850
    lineHeight: 1.05
    letterSpacing: "-.025em"
    fontVariation: "'wdth' 115"
  game-title:
    fontFamily: "Anybody, Inter, sans-serif"
    fontSize: "clamp(23px, 6.9vw, 30px)"
    fontWeight: 850
    lineHeight: 1.06
    letterSpacing: "-.04em"
    fontVariation: "'wdth' 115"
  section-title:
    fontFamily: "Anybody, Inter, sans-serif"
    fontSize: "21px"
    fontWeight: 850
    lineHeight: 1.2
    letterSpacing: "-.025em"
    fontVariation: "'wdth' 115"
  card-title:
    fontFamily: "Inter, sans-serif"
    fontSize: "15px"
    fontWeight: 850
    lineHeight: 1.05
    letterSpacing: "-.03em"
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
  description:
    fontFamily: "Inter, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.45
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "17px"
    fontWeight: 850
    lineHeight: 1.4
  nav-label:
    fontFamily: "Inter, sans-serif"
    fontSize: "10px"
    fontWeight: 650
    lineHeight: 1.4
  nav-label-compact:
    fontFamily: "Inter, sans-serif"
    fontSize: "9px"
    fontWeight: 700
    lineHeight: 1.4
  hud-value:
    fontFamily: "Inter, sans-serif"
    fontSize: "clamp(18px, 6.4vw, 29px)"
    fontWeight: 850
    lineHeight: 1.12
  hud-label:
    fontFamily: "Inter, sans-serif"
    fontSize: "clamp(9px, 2.8vw, 11px)"
    fontWeight: 750
    lineHeight: 1.4
    letterSpacing: ".35px"
rounded:
  cell: "6px"
  field: "12px"
  collection: "13px"
  nav-item: "14px"
  cover: "15px"
  board: "17px"
  hud: "20px"
  game-tile: "18px"
  module: "19px"
  card: "20px"
  sheet: "21px"
  nav: "22px"
  nav-pill: "28px"
  nav-active-indicator: "4px"
  chip: "23px"
  currency: "24px"
  home-sheet: "25px"
  dialog: "27px"
  control: "30px"
  desktop-shell: "33px"
  circle: "50%"
  glass-tube: "0"
  fluid-cylinder: "0 0 11px 11px"
  liquid-band: "48% / 9%"
spacing:
  micro: "3px"
  small: "5px"
  control-gap: "7px"
  compact: "8px"
  inline: "10px"
  gap: "12px"
  game-inset: "14px"
  section-inset: "18px"
  page-inset: "20px"
  dialog-inset: "24px"
components:
  button-primary:
    textColor: "{colors.pure-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "52px"
  button-secondary:
    textColor: "{colors.secondary-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "52px"
  button-gold:
    textColor: "#15305b"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "52px"
  button-disabled:
    backgroundColor: "{colors.disabled-surface}"
    textColor: "{colors.disabled-ink}"
    rounded: "{rounded.control}"
  name-input:
    backgroundColor: "{colors.pure-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px"
    height: "48px"
  navigation:
    textColor: "{colors.nav-ink}"
    typography: "{typography.nav-label}"
    rounded: "{rounded.nav-item}"
    height: "60px"
  navigation-active:
    backgroundColor: "{colors.ice}"
    textColor: "{colors.nav-active}"
    rounded: "{rounded.nav-item}"
  category-chip:
    backgroundColor: "{colors.chip-ice}"
    textColor: "{colors.chip-ink}"
    rounded: "{rounded.chip}"
    padding: "9px 7px"
    height: "46px"
  game-card:
    backgroundColor: "{colors.pure-white}"
    rounded: "{rounded.card}"
  game-hud:
    backgroundColor: "{colors.hud-navy}"
    textColor: "{colors.pure-white}"
    rounded: "{rounded.hud}"
    padding: "9px 5px"
    height: "70px"
  sort-tube:
    rounded: "{rounded.glass-tube}"
    width: "73px"
    height: "210px"
  merge-chamber:
    width: "456px"
    height: "490px"
  game-tool:
    textColor: "{colors.pure-white}"
    rounded: "{rounded.card}"
    padding: "9px 5px 6px"
    width: "70px"
    height: "70px"
---

# Design System: Peak Haven Arcade

## Overview

**Creative North Star: "The Alpine Bottle Adventure"**

Peak Haven Arcade is a luminous alpine game world: blue castles and winding cyan paths, a happy silver-capped glass bottle companion, collectible short vials, and silver, blue, and gold reward chests. The supplied October 10 reference images and later gameplay references establish its visual authority. This approved identity supersedes the former robot and Nunito system.

A narrow mobile shell combines full raster environments with live game pieces, legible navy information surfaces, and glowing glass-and-metal controls. Anybody supplies the wide geometric display voice; Inter carries instructions, labels, and saved statistics. Physical highlights belong to glass, metal, and actions. Illustration supplies atmosphere while boards, scores, progress, and reward states remain interactive and truthful.

**Key Characteristics:**

- A centered mobile shell with five visible navigation labels outside gameplay.
- White PH Arcade logo, official Peak Haven symbol, and one glass bottle mascot.
- Illustrated alpine, crystal-cave, and botanical-glasshouse environments behind live games.
- Navy information, electric blue actions, cyan glass edges, and gold reward or selection feedback.
- Keyboard states, numbered or named pieces, local progress, and optional decorative motion.

## Colors

The normative palette combines deep navy, electric blue, cyan glass highlights, icy information surfaces, and warm gold. All seven root color properties are recorded in the frontmatter under their source names, including the distinction between the root off-white and literal white content. Other listed colors are reused component or game-state values.

### Primary

- **Electric action blue:** `blue` drives the brand accent. The primary button uses a blue gradient, a `control-rim` edge, white text, and an inset highlight; the larger gameplay action strengthens the cyan top and glow.
- **Glass cyan:** `sky` supplies luminous brand highlights, selection, and environmental continuity. It complements navy rather than replacing a readable text surface.

### Secondary

- **Game liquids:** `liquid-cyan`, `liquid-pink`, `liquid-gold`, `liquid-purple`, `liquid-green`, and `liquid-blue` are the six numbered Lab Sort colors and game feedback palette. They identify pieces; they do not define a second general-purpose interface palette.

### Tertiary

- **Reward gold:** `gold` identifies coins, stars, selection or hint outlines, and keyboard focus. Claim actions use a light-to-gold gradient with navy type. Reward meaning comes from labels and real state alongside color.

### Neutral

- **Mountain navy:** `ink` is the global foreground. `world-navy` is the gameplay base; `hud-navy` and `hud-label` preserve readability over scene art.
- **Ice and white:** `ice`, `white`, `pure-white`, `shell-ice`, `panel-ice`, `panel-shade`, and `outer-sky` distinguish information planes from the illustrated world.
- **Supporting copy and states:** `muted`, `nav-ink`, `secondary-ink`, and `chip-ink` provide dark copy on light surfaces. `nav-active` is the selected light-nav foreground. Disabled controls use their own surface, edge, and ink trio.

**The Live World Rule.** Illustration establishes the environment; game boards, scores, loading progress, and earned states must be rendered from actual state.

Sidecar tonal ramps are synthesized preview metadata, not additional production colors. No retired robot palette or superseded light canvas colors are normative.

## Typography

**Display Font:** locally hosted variable Anybody, followed by Inter and sans-serif.
**Body Font:** locally hosted variable Inter, followed by sans-serif.

Monument Extended was unavailable; Anybody with the observed wide axis is the explicit substitute. Both font files declare weights 100–900 and swap loading. The display voice is broad, confident, and compact; the body remains plain and readable.

### Hierarchy

- **Display:** the responsive home heading uses the frontmatter display clamp, tight line height, wide axis, and negative tracking. At the narrow breakpoint its inherited size may be overridden by the final responsive clamp; record the cascade, not an earlier fixed heading size.
- **Headline:** standard page headings use the headline role. Game titles use their own responsive clamp and tighter tracking; section headings use the smaller section-title role.
- **Card title:** the horizontally scrolling game shelf uses Inter at the card-title role; it does not inherit the display face.
- **Body / description:** the global body role sets the interface; paragraphs commonly use the description role and a slightly more generous line height. Gameplay messages remain short and status-focused.
- **Label / HUD:** primary actions use the label role. Navigation labels stay visible; HUD values use tabular numbers and the hud-value role, with the compact hud-label directly above. HUD values reduce to 23px on narrow screens.

**The Two Voices Rule.** Use Anybody for wide display headings and Inter for practical reading. Preserve the white PH Arcade logo artwork rather than reconstructing it with text.

## Layout

The centered shell is `width:min(100%,480px)` and fills the mobile viewport. Non-game pages reserve `84px + env(safe-area-inset-bottom)` for fixed bottom navigation. The current header is an absolute 100px overlay, with a responsive logo width and real 44px-minimum currency and settings actions. The home text remains on the left with a bright legibility wash; the bottle mascot occupies the right.

The game shelf is a horizontally scrolling row of 120–126px tiles with 10px gaps and proximity scroll snapping. Each tile pairs one proportional, transparent game illustration with its title; the home shelf does not repeat a large cover, description, and play badge for every game. The larger free-play cards retain their full scene art. Recent games also scroll horizontally. The map retains three chapters of six missions, a cyan winding path, numbered or locked platforms, a selected-level preview, and the large play action. Those map positions are a surface composition, not a reusable page grid.

Gameplay and loading omit the site header and bottom navigation. Game worlds fill the viewport, use 16px top and 14px side insets, and apply a navy gradient veil behind header, HUD, and lower controls. Tower uses an alpine valley; Merge and Peak Blocks use the crystal cave; Lab Sort and Bottle Mahjong use the botanical glasshouse. These are full scene backgrounds behind separate boards and controls.

Tower and Merge have transparent 480:580 canvas frames sized from the remaining viewport height. Tower fits individual bottle crops into a logical 124×170 maximum, with 164px stack spacing and a camera target that holds the top bottle around y=320. This keeps the active bottle large and readable rather than shrinking the whole stack. Merge places its dimensional chamber at x=12, y=72 with a logical 456×490 footprint; the live vial physics occupy its transparent interior. Lab Sort wraps tubes, widening the hit area into three columns when there are more than five tubes and four columns when there are more than six. Peak Blocks has an 8×8 square board with 3px cell gaps, three piece slots, and tool controls. Mahjong has a positioned 6:5 layered board. Game actions and puzzle tools follow the board; instructions remain in a polite status region.

At 650px and wider, the body gains 20px vertical inset, the shell gains rounded corners, the nav rises by 20px, and gameplay height accounts for the inset. At 370px and narrower, header and game side insets reduce to 10px, the logo is 100px wide, and pieces and tubes adjust. At viewport heights of 730px and below, HUD, action, tool, and board spacing compress to leave room for live play. At heights of 900px and above, the map path grows. No breakpoint introduces a desktop sidebar.

## Elevation & Depth

This world uses illustrated depth plus functional glass and metal. Primary controls have a light rim and inset specular highlight with soft blue shadow; the larger game action adds a stronger cyan glow. HUD panels use a dark translucent face and a restrained inset blue glow. Sort tubes use a raster clear-glass cylinder with dimensional chrome rim and base, layered above live liquid; selected glass lifts and receives a soft golden glow. Merge uses a raster chrome frame, glass walls, and segmented blue base around its live canvas vials. Supporting cards use diffuse low shadows instead of receiving the full primary-action finish.

### Shadow Vocabulary

- **Primary control:** `inset 0 2px 3px #f4ffffa8,inset 0 -3px 7px #00258d55,0 5px 12px #028ee73d`.
- **Gameplay action:** `inset 0 2px 4px #ffffffb0,inset 0 -4px 7px #00208d66,0 0 15px #03d7ff88`.
- **Supporting game card:** `0 5px 20px #31739c21`.
- **Selected glass tube:** `filter:drop-shadow(0 0 8px #fff26b)` on the actual glass silhouette. Its default depth comes from the raster material; the retired CSS wall borders and box shadows are overridden.
- **Liquid cylinder:** `inset 0 -4px 6px #04174233` inside live curved liquid bands.
- **Dialog:** `0 18px 70px #00183f99`; its navy backdrop uses 6px blur. Bottom navigation uses 14px blur.

**The Material Rule.** Use rims, specular highlights, and glow where glass, metal, selection, or a primary game action explains them. Do not give every supporting panel the same luminous treatment.

CSS settling uses the root easing. Screen entrance lasts 260ms; control transforms last 150ms; loading fill lasts 180ms; mission and XP fill lasts 300ms. Pressing the primary button scales it to .96 and moves it down 2px. Fine-pointer hover brightens primary actions. Decorative mascot loops float slowly, while completed-run confetti and score impacts occur only in response to play.

The local motion switch and `prefers-reduced-motion` suppress CSS animations and transitions. JavaScript gates impact movement, pours, confetti, particles, and decorative canvas movement with both settings. Impact text remains visible briefly without motion. Essential gameplay physics and state updates remain active. Sound is optional and initially off.

## Shapes

Forms are curved, tactile, and materially specific. Frontmatter radius tokens describe actual cells, inputs, covers, cards, HUD capsules, dialogs, and controls. Pill-like actions use the control radius; circular icon controls remain distinct from them. The game board frame and card corners are related but not identical.

The white PH Arcade logo and official symbol preserve their source proportions. The happy mascot is a glass bottle with a silver cap. Collectible vials are short glass silhouettes sampled from a six-cell atlas; ordinary CSS vials use a 1:2 aspect ratio. Canvas sprite drawing uses tight, individual source bounds for each happy or collectible vial and fits each crop proportionally; transparent margins no longer determine its apparent size. Lab Sort overlays `sort-glass.webp` above a separate live fluid cylinder. The glass has a polished elliptical rim and foot; liquid bands use cylindrical lighting, an elliptical meniscus, small bubble highlights, and numbers, with a bottom tube index. The default glass is 73×210px with a 78px button, the fluid inset is 9% top / 10% sides / 8% bottom, and dense or short layouts reduce dimensions. The chamber asset `merge-chamber.webp` supplies the chrome frame and segmented blue base without baked pieces or scores. Do not substitute the former robot or square vial crops.

## Components

### Buttons

Tactile and clearly actionable. Primary, secondary, and gold variants share curved silhouettes and visible focus. Primary and gold faces use gradients recorded in the sidecar; secondary and ghost share the pale face in this build. Default primary actions have 52px minimum height and the frontmatter padding. The final game action is 64px high and has its own brighter finish; short viewports reduce it to 56px. Disabled controls remove glow and retain dark text. Fine-pointer hover increases brightness; active press changes scale and position.

### Chips

Home categories are three soft category buttons, 46px minimum height, with a pale inactive face and dark label. The selected state uses a cyan-to-blue gradient and white copy. Selection comes from actual filtering state and remains separate from main navigation.

### Cards / Containers

Game cards pair a clipped scene cover with a short title, description, real record, and explicit action. The home shelf uses lighter cover-and-copy tiles on the common white sheet. Profile and rewards use icy information modules, bottle shelves, and achievement shelves. Bottle ownership is independent of equipment: owned bottles show a check, available unowned bottles show an arrow, and unavailable bottles show a lock. Equipped bottles retain their separate highlight and label. The sidecar card specimen captures the diffuse supporting-card finish, not a mandate to wrap every group in a card.

### Inputs / Fields

The profile-name field is a native input with a pale-blue stroke, white background, 12px corners, 10px padding, 16px text, and 48px minimum height. Native 22px settings checkboxes use the action blue. All retain the visible gold focus outline; form labels and dialog headings remain available to assistive technology.

### Navigation

Five icon-and-text tabs: Home, Arcade, Rewards, Bottles, and Profile. Each tab uses a 60px minimum height and the nav-label role inside the same inset navy pill, with 16px horizontal screen clearance and a safe-area-aware bottom offset. All pages share the dark surface, muted inactive items, and luminous cyan-edged active item. Icons use fixed square dimensions so the gamepad, gift, bottle, and profile marks keep their intended proportions. `aria-current="page"` exposes the actual selected route. Gameplay and loading focus on their own close, help, pause, and recovery controls.

### Live Gameplay and Loading

The shared game header precedes three matching glossy blue stat cards, objective, and board. Each 72px card uses the same cyan-to-blue face, pale glass rim, white label, tabular value, and softly offset blue shadow as the selected primary-button treatment. Its three columns stay proportional; icon glyphs retain a fixed square aspect ratio and values shrink or ellipsize rather than distorting the artwork. Tower and Merge use keyboard-enabled canvas with external HUD and status. Lab Sort exposes tube contents bottom-to-top, selected state, numbered liquid colors, legend, Undo, Hint, and Reset; rendering restores tube focus. Its transparent raster glass is an inert overlay over the live fluid cylinder, so pouring changes the liquid state rather than a prepainted bottle. Merge similarly keeps real falling, collision, and tier-matching vials inside its raster chamber. Peak Blocks uses a labeled 8×8 grid with roving arrow-key focus, real occupied cells, shape selection, placement previews, and finite tools. Mahjong exposes tile names, layer or availability, and selected state, with genuine matching and open-side rules. Tools show remaining uses and disable when unavailable.

Loading uses the alpine scene, white logo, mascot, actual asset-progress bar, cancel, and load-failure retry. Sort glass and the Merge chamber are included in their respective game preload lists. Result views retain the bottle mascot, actual score, XP, run details, earned local currency, and relevant replay or next-mission actions. The original 18 missions remain sequential; the two newer puzzle games extend free play rather than altering that progression.

### Accessibility and Local State

Keyboard focus is a 3px gold outline at 4px offset. Native dialogs use their visible heading for an accessible name; game status and toast feedback are polite live regions. Controls supplement color with icons, numbers, names, selected state, or locks. Header and main game actions preserve the larger touch targets. Small ancillary text and a few smaller secondary controls in the build are not a recommended accessibility scale. Canvas gameplay remains visually spatial; equivalent nonvisual gameplay is not established.

Progress, personal records, tutorial state, local currency, and preferences stay in the existing browser-local data model. Save failures report feedback without blocking play. Generated artwork has adjacent `.provenance.json` records and remains separate from official supplied brand assets. The new sort-glass and merge-chamber records retain the full original source path, SHA-256, AI tool, reference image, generation summary, and derivation crop; the original generated sources are retained. Source inspection for this refresh covered the final CSS cascade, app, canvas engines, puzzle games, and the imported liquid palette; no new browser verification or accessibility audit is claimed.

## Do's and Don'ts

### Do:

- Do preserve the 480px maximum shell, five labeled tabs, and safe-area spacing outside gameplay.
- Do retain the white PH Arcade logo, official symbol, glass bottle mascot, and proportional vial artwork.
- Do keep raster glass and chrome materials separate from live liquids, vial physics, and scores.
- Do preserve individual vial source bounds and the large focal Tower bottle.
- Do distinguish bottle ownership, equipment, availability, and locking with the actual saved state.
- Do use Anybody for wide display and Inter for instructions, labels, and local statistics.
- Do keep all five game boards and HUD values live over the illustrated scenes.
- Do retain visible gold keyboard focus, piece numbers or names, accessible states, and polite feedback.
- Do respect both the local decorative-motion setting and the system reduced-motion preference.
- Do make loading progress real and retain cancel and retry recovery.
- Do describe progress and currency as saved on this device.

### Don't:

- Don’t restore the superseded robot, Nunito identity, or desktop dashboard shell.
- Don’t stretch the logo, mascot, or short vial sprites to fill an unrelated shape.
- Don’t bake a game board, score, or reward claim into scene artwork.
- Don’t add decorative kickers, glyph icons, or hard offset type shadows as reusable house styles.
- Don’t use scene art as the sole background for small instructions; retain the navy HUD or readable information surface.
- Don’t remove essential game movement when decorative effects are off.
- Don’t promise accounts, cross-device sync, cash value, or store rewards for local game currency.
- Don’t claim the canvas games provide an equivalent nonvisual spatial experience.
