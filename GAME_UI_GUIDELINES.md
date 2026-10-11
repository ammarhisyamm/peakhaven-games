# PH Arcade — Alpine Lab interface

The interface belongs to the bottle laboratory. A game selection is a bottle on a display pedestal; a reward is an object in a treasury tray; a collection is a rack of real vials. Keep the existing PH identity, nine games, inset navigation, and device-local progress.

## Scene and camera

Each route is one continuous illustrated location. The sharp portrait environment belongs to the document and moves with its objects when the player scrolls. Desktop side scenery is a blurred extension. The legibility gradient remains fixed to the viewport. Gameplay stays in a stable camera with a clear board; never move interactive targets with decorative parallax. Avoid image seams, white sheets, and stretched source art.

## Materials and depth

- Environment: alpine terraces, glasshouses, crystal laboratories, treasury, observatory.
- Furniture: generated chrome/cobalt console frame, gold treasury frame, cyan glass display pedestal. Use nine-slice frames so corners and chrome thickness keep their shape at different sizes.
- Objects: proportional supplied bottle and game sprites sit on pedestals with a small contact shadow. Their icon is the focal content, not a crop of the environment.
- Controls: live glossy cyan/blue primary buttons, dark blue secondary controls, and gold claim actions. Keep the navbar as the established separate navigation layer.
- Hierarchy: one main action per section, readable navy backing for information, minimal nested framing. A panel frame carries a real task, not decorative filler.

## Menu composition

Home: keep the mascot as an illustration above the game grid; do not overlay a Play Now banner button. Each game object launches its own game. Use a three-column grid of all nine game objects plus daily rewards, then a daily challenge terminal. Let the grid scroll vertically with page content. Filter controls expose selected state.

Arcade: three puzzle tabs, a level console with circular nodes and a selected-level launch action, then six endless game displays. Sort, Mahjong and Sequence retain levels. Tower, Merge, Blocks, Orbit, Ridge Run and Bond show high scores and become harder during a run.

Rewards: daily chest on a pedestal is the focal action, gold treasury material for rewards, a readable XP console, streak, reward calendar and tools.

Bottles: equipped vial on its own display, then a rack of six bottles. Ownership, equipment and availability use labels and icons alongside colour.

Profile: bottle avatar attached to the player terminal, actual stats, bottle rack, achievement tray, settings. No Your Games section. Frame Settings, Customize and Help as three related quick actions inside a slim chrome console. At 370px and narrower, the name and XP use a full-width second row below avatar/edit controls.

Game chooser: two-column physical pedestal displays for all nine distinct game objects, names, truthful best score or puzzle level, and a launch action. No repeated generic picture cards.

Gameplay: occupy a full mobile-screen modal layer, capped at 480px and centered on desktop, with no document scrolling or framed outer arena. Remove visible game titles, header slabs, instruction slabs and repeated launch CTAs. Keep one 48px back arrow plus three compact live stats above the playable area. The back arrow pauses and opens a menu containing resume, sound toggle, instructions and exit. A first-visit tutorial is the only pre-game launch step. Tap/drag on the actual board or canvas to play; retain keyboard controls. Puzzle tools remain compact and separate from primary gameplay input. Brief live status sits at the safe bottom edge, with no interaction blocked by it.

Canvas dimensions follow the mobile shell with uniform scaling, never stretched pixels. Tower/Merge keep their calibrated physics coordinates centered in the available area; the four new games adapt their geometry to the visible play area. Distinct game background per game; no baked title, score, button or board state in scenery. Orbit is a ballistic pull/aim/release ball-to-hoop game with three misses; it is distinct from Bond's timed attachment mechanic. Ridge Run uses a proportional rendered glass vial and bottle obstacles touching the top and bottom edges; preserve the cap and branded label dimensions, extend the glass body, and freeze each opening when spawned. Bond launches immediately, with a 65ms debounce and 120ms flight; overlapping flights are allowed and collision rules still apply. Sequence accepts all adjacent attempts in four directions, animates an unmatched pair back without spending a move, and resolves matches through animated clears and gravity. Long swipes select one adjacent cell. Peak Blocks supports drag and drop with a lifted preview plus its tap and keyboard controls. All new glass vial labels carry the supplied Peak Haven mark in white. Ambient particles and trails respect reduced motion; essential physics stays on.

## Interaction and accessibility

Minimum action target 44px, including dialog close. Fixed-square icons and circular controls use aspect-ratio 1. Use 20px page gutters, 18px at 420px and narrower, and 16px at 370px and narrower; include top and bottom breathing room around controls and sections. Preserve safe areas. Menu body instructions use at least 13px with 1.45–1.5 line height on a navy reading surface; the shipped compact gameplay status uses 12px/1.5. Auxiliary 7–11px captions are inherited density debt rather than an instruction-text standard; large headings stay at 3:1 contrast and body copy at 4.5:1. Long names wrap, number values are tabular, selected controls have aria-pressed or aria-selected, and keyboard focus is a gold outline.

The shipped scene entrance is 260ms with cubic-bezier(.16,1,.3,1); keep one entrance. Pedestal press moves down 2px. No moving hit targets, no idle motion on every object, and no ornamental parallax on scroll. Respect reduced-motion and the player's motion setting. Sound remains optional and its saved preference continues to apply to every game.

Loading uses the same 480px mobile shell as the game, fits the logo/mascot/console/cancel into the current viewport, and clips the fill inside its rounded track. It reports actual asset progress, includes its console material, and has cancel/retry. Preserve tutorials, pause/help, game tools, loss/retry dummy coins, local saves, and procedural difficulty. The prototype makes no payment or cloud-save claim.

## Source assets

UI furniture in `dist/assets/ui/` is generated raster material with alpha, prompt sidecars and retained original source paths. Semantic HTML owns text, buttons, state and focus. CSS owns layout and responsive dimensions. Nine-slice frames may resize; sprites keep their natural aspect ratio. Console slices are 19% 13% 23% 13% fill with 23px image width (17px for slim furniture); treasury slices are 21% 14% 22% 14% fill with 25px image width. New materials are console-frame.webp, treasury-frame.webp and vial-pedestal.webp; home-lobby.webp supplies the open terrace. Their adjacent .webp.json records retain prompt, source path, hash and derivation. Legacy filenames map Tower to the stacked merge.png and Merge to the swirling tower.png. Do not infer game semantics from those filenames.
