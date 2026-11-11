# The designer on a phone

The plan for editing tracks at 375 px (#117): what the phone gets in which order, the layout, the touch interactions,
what changes on a tablet, what the code needs, and the build tickets for the Board to approve. Mockups are in
`phone/` (static HTML/CSS on the app's tokens, 375 × 812). This is design only: nothing in the app changes with it.

Today the designer below 640 px shows a view-only plan and says "Design on a laptop or tablet"
(`Designer375.dc.html`). The desktop layout is three columns (palette, plan, side panel) under a bar of ten
controls; the tablet layout (#16) is the plan with a dock of 44 px buttons and a floating sheet. Neither fits 375 px:
the bar alone wraps to four rows, and the side panel would leave no plan.

## Scope by stage

**Stage 1: tweak an existing layout on a phone.** Open a track from the library (or a link from the forum), move or
delete corners, cut a corner back, change a jump's type or size, move the start line, add a corner with the Add point
tool (#114), see the Checks, save a revision and submit it. Both modes work; Quick is the default and Advanced is in
the overflow menu with the same sheets (its number fields and snap modes fit a sheet as they are).

**Stage 2: draw a whole layout in Quick mode on a phone.** Step 1 (lay the lanes) and the rest of step 2 (shape it)
from a blank design, including picking the venue and the area on the New track page at 375 px.

What's hard about stage 2, and why it comes second:

- **Precision.** Laying the lanes is a continuous drag through 2 m squares. On a 22 × 12 m area fitted to 375 px a
  square is 32 px, smaller than a finger (44 px), and the finger hides the square it is on. The grid has to be zoomed
  so a square is at least a finger wide (56 px in the mockup), which means the whole area never fits on screen while
  you draw.
- **Scrolling while drawing.** With the grid zoomed, the drag has to scroll the plan when the finger nears an edge
  (edge auto-scroll), and a second finger must keep meaning "pan, paint nothing" (`Fingers` in `lib/touch.ts`). Both
  are new behaviour with their own failure modes (runaway scroll, a square painted by accident when the plan moves
  under a still finger). A mini-map keeps the whole loop in view.
- **Closing the loop.** The ring on the first square may be off screen when you come back to it; the mini-map and
  the hint have to carry that.
- **The New track page** (venue, area size, lane width) has no phone layout yet, and the venue picker reads the
  forum.

Stage 1 needs none of that: an existing layout is edited by tapping and dragging single handles, which the tablet
layout already does, and pinch zoom gives the precision.

## Layout at 375 px

Mockup: [`phone/01-plan-toolbar.html`](phone/01-plan-toolbar.html).

The track gets the whole screen. Three bands, top to bottom:

1. **Header, 52 px**: Back (44 px), the track name (read only here; it is edited under Layout details), the save
   state in a word ("Saved", "Unsaved", "Not saved yet") and the overflow menu button (⋯). The name is the
   only thing that truncates.
2. **The plan**, everything between. It opens fitted to the width of the track area, so a landscape area shows with
   floor above and below; the first hint says to pinch in. Over the plan: the hint chip (top left, as on desktop and
   tablet), the checks pill (top right, as on tablet: "No problems", "1 warning", "1 error"), the scale bar
   (bottom left). The zoom buttons and the layers menu go: pinch replaces zoom, and Zoom to fit is in the overflow.
3. **Bottom toolbar, 64 px**, the main tools within thumb reach, each a 44 px target with a label:
   Select · Add point · Jump · Delete · Undo · Redo · 3D. Add point and Jump are modes (`aria-pressed`); Delete is
   enabled while something is selected; 3D swaps to "2D" while the 3D preview (#85) is showing, which is view only
   as it is on desktop.

Where every current control goes:

| Desktop control | On the phone |
|---|---|
| Back, track name, save state | Header |
| Venue · size, status badge | Layout details sheet |
| Quick / Advanced | Overflow menu (a segmented control in the menu) |
| Undo, Redo | Toolbar |
| Reverse direction | Overflow menu |
| Save track / Save revision, the note popover | Overflow menu; the note is a sheet |
| Submit track, and why it's blocked | Overflow menu; the row's second line says why ("Waiting on 1 error · see Checks") |
| Jumps palette (with Crossover), Start line | The Jump sheet, from the toolbar's Jump button |
| Add point | Toolbar |
| Snap to lanes / the Snap radio (Advanced) | The Jump sheet's last row (Quick: a switch; Advanced: the radio) |
| Zoom buttons, layers | Pinch; Zoom to fit in the overflow; layers stay on by default (a stage 2 row in the overflow if asked for) |
| 2D / 3D switch | Toolbar |
| Hint chip | Over the plan, same words with "tap" for "click" |
| Checks (Advanced tab), checks pill (tablet) | The checks pill and the Checks sheet, in both modes |
| Venue check panel | A section of the Checks sheet |
| Selection panel | The selection sheet |
| How to draw, Shortcuts | How to draw in the overflow menu, as a sheet; keyboard shortcuts are left out |
| Stats (lap, corners, jumps) | The bottom of the Checks sheet |
| Messages (restore unsaved changes, not logged in, approved revision) | One dismissible banner under the header, the same `Message` component |
| Steps (1 · Lay the lanes, 2 · Shape it) | A 44 px steps row under the header, only while laying (stage 2) |

### Bottom sheets

Mockups: [`phone/02-selected-point.html`](phone/02-selected-point.html) (a corner),
[`phone/03-checks-sheet.html`](phone/03-checks-sheet.html) (Checks).

Panels become **bottom sheets** that slide up between the plan and the toolbar, so Undo and Delete stay in reach
while a sheet is open (the overflow menu is the one exception: it is modal, over a scrim). A sheet has a grab bar, a close button, and two heights: **peek** (its content, about a third
of the screen) and **full** (up to 72 px below the header, scrolling inside). Pull the grab bar to change height;
pull down past peek, tap Close, or tap the plan to dismiss. One sheet at a time. The sheets:

- **Selection**: the selected corner, corner point, jump or start line, with the same fields as the desktop panel
  (`SelectionPanel`, in its `touch` form): the heading and turn, Quick sizes as four chips, the apex radius as a
  stepper (− / value / +, so no keyboard pops up), Outside corner. Delete is on the toolbar, not repeated in the
  sheet. Opens at peek when something is tapped. Advanced adds its number fields and the lane widths in the same
  sheet.
- **Checks**: the checks pill opens it at full height: counts, the rows in the same words as the Advanced tab's
  Checks, with a 44 px Show on each that pans the plan to the problem and drops the sheet to peek; the "Submit is
  waiting on…" line; the venue check; the figures at the bottom.
- **Jump**: Tabletop, Double, Kicker, Whoops, Crossover (and Step-up, Step-down, Bump in Advanced) as a grid of
  44 px chips with the plan symbols, Start line, and the snap setting. Picking one arms the tool and closes the sheet;
  the hint says "Tap on the racing line to place it".
- **How to draw**: the Quick or Advanced text, with the keyboard lines removed and "tap" for "click".
- **Layout details**: name, venue and size, status, description.
- **Save**: "What changed?" and the Save button, as the desktop popover.

### The overflow menu

Mockup: [`phone/04-overflow-menu.html`](phone/04-overflow-menu.html).

One menu, from ⋯ in the header, as a bottom sheet with a Close button, over a scrim that covers the plan and the
toolbar (it is the one modal sheet; tap the scrim or Close to dismiss), for the things done once per session: Save revision
(the primary row), Submit track (disabled with the reason as its second line), Mode (Quick | Advanced), Reverse
direction, Zoom to fit, Layout details, How to draw, Back to track. Eight rows of 52 px fit without scrolling. Help
is How to draw; there is no separate help page.

## Touch interactions

- **Pinch to zoom and two-finger pan**, wherever the fingers land, handles included; a second finger cancels
  whatever the first was doing and nothing is painted or moved. This is what `PlanView` and `lib/touch.ts` do
  already (#16). One finger on empty floor pans too, as on the tablet.
- **Tap to select.** A tap on a corner, apex handle, jump or start line selects it and opens its sheet at peek. A
  tap on the floor clears the selection (with Add point on, it adds a corner, #114).
- **Drag to move, with a loupe.** A finger on a handle that moves past the 8 px slop drags it, snapping as now. While
  it drags, a **loupe** shows above the finger: a circle 128 px across with the plan magnified 2.4 × round the point,
  a crosshair, and the position in metres, so the finger isn't hiding what it's moving. It follows the finger and
  goes when the finger lifts. Same for the apex handle (shows the radius), jumps and the start line (show the
  distance along the lap).
- **Long press for the context menu.** Holding a corner, jump or the start line for 500 ms (`LONG_PRESS_MS`) opens
  a small sheet of actions for it: Delete, Square / Round outside corner, and in Advanced Make hairpin (`H`). This
  keeps ADR 0005: a long press never deletes by itself, because Chrome fires `contextmenu` on a long press; the
  app's `contextmenu` handlers must do nothing on touch (Quick's corner already checks the pointer was a mouse;
  Advanced's corner point deletes on any `contextmenu` today and needs the same guard). On the tablet a long press on a corner opens its panel
  today; it moves to the same context sheet there, and a tap opens the panel.
- **Nothing relies on hover.** The hint chip carries what the desktop puts in `title` tooltips; the jump and
  check hover cards on the plan already open on tap in `PlanView`.
- **Keyboard**: a phone with a keyboard attached gets the desktop shortcuts unchanged; nothing in the sheets needs
  one.

## Tablet (768 to 1024 px)

The tablet layout (#16) stays for Quick mode in landscape at 1024 px: the bar, the dock and the floating sheet. Two
changes:

- **Portrait tablets (768 × 1024)** and any touch screen narrower than 900 px use the phone layout (header, plan,
  bottom toolbar, bottom sheets) with the toolbar's labels kept and the sheets at a maximum width of 480 px, centred.
  Today the dock wraps to two rows there and the sheet covers most of the plan.
- The floating `designer-sheet` on 1024 px tablets becomes the same `Sheet` component docked to the right edge
  instead of the bottom, so the two layouts share one piece of code; it looks as it does now.

Advanced mode on tablets keeps the desktop layout as it does today, with its 36 px controls; making them 44 px is
a follow-up, not part of this plan.

## What the code needs

Reading `apps/web/src/designer/Designer.tsx` (2,574 lines), `PlanView.tsx` and `styles.css`:

- **Breakpoints.** `PHONE_QUERY` (`max-width: 640px`) picks the view-only screen; `TOUCH_QUERY`
  (`pointer: coarse`) plus Quick mode picks the tablet layout. The phone layout replaces the view-only branch (a
  `phone` layout rather than a dead end) and is also used for coarse pointers up to 900 px. Desktop is unchanged:
  it is the fallback when neither query matches, and no desktop CSS moves.
- **A layout shell.** The designer's state (draft, history, bake, tool, selection, snap) is one component and stays
  so; the three layouts differ only in where things render. Pull the bar, palette, plan overlays and side panel out
  of the big return into small components taking props (`DesignerBar`, `ToolPalette`, `PlanOverlays`, `SidePanels`),
  then a `DesignerLayout` picks desktop / tablet / phone. The tablet branch already shows the pattern
  (`tablet ? null : …`); this removes the ternaries. Risk to desktop: moving JSX, not changing it; the existing
  Playwright suites (`apps/web/e2e`) and `test/*.test.tsx` static renders cover the desktop and tablet layouts and
  run unchanged.
- **`Sheet`** (new, `components/Sheet.tsx`): peek / full / closed, grab bar, drag to resize, swipe down to close,
  `role="dialog"`, focus kept inside while full, `100dvh`-safe. Replaces `.designer-sheet` on tablets. Reduced
  motion: no slide, just show.
- **`BottomToolbar`** (new): the tablet dock's buttons in the phone's arrangement; reuses `JumpPalette` for the
  Jump sheet's chips.
- **`OverflowMenu`** (new): a `Sheet` with menu rows; `role="menu"` and arrow keys for the keyboard.
- **`Loupe`** (new, in `PlanView`): a second `<svg>` with a `<use>` of the plan's content group and its own
  `viewBox`, positioned by the designer during a drag. Needs the plan's content in one `<g id>`; `PlanView` gets an
  `onDrag` position callback or renders the loupe itself from the `overlay` prop. Only mounted during a drag, so no
  cost otherwise. Performance on a phone is the unknown: the whole plan drawn twice at 2.4 × while dragging. If it
  stutters, the loupe draws only the area, lanes and handles (no texture, no grid labels).
- **Long press** (`press` state in `Designer.tsx`): today it selects a corner and opens the tablet sheet. It opens
  the context sheet instead; `contextmenu` from a touch is ignored (`pointerType` is remembered from the press).
- **The toolbar's Delete** calls `deleteSelection`; the selection sheet's Delete button goes on touch.
- **Header**: the designer at 375 px hides the app header so the designer owns the screen; Back goes to the track
  page. This is new: on tablets the designer only fills what the header leaves (`#root:has(.designer-touch)`).
- **3D on a phone**: the 3D preview (#85) is switched off below `PHONE_QUERY` today ("not on phones" in
  `Designer.tsx`). Ticket 3 lifts that; the fallback to the 2D plan when WebGL is missing or lost stays as it is.
  The cost of three.js on a phone is the unknown to measure there.
- **The messages** (`designer-messages`) become one dismissible banner at 375 px; the restore prompt must still be
  reachable (it is the only way back to unsaved work).
- **Tests.** Vitest static renders for the phone layout (as `test/checks-tab.test.tsx` does with a mocked bake), and
  Playwright with `viewport: 375 × 812, hasTouch: true` using `e2e/touch-helper.ts` (`Touch`, `screen`, `cell`), for:
  tap selects and opens the sheet, drag moves with the loupe showing, long press opens the context sheet and deletes
  nothing, pinch zooms, the overflow saves, Checks' Show pans. The known Chromium CDP touch quirks are
  handled in the helper.
  `test/phone-design.test.ts` keeps this plan honest about today's code (`PHONE_QUERY`, `LONG_PRESS_MS` and how
  they are used); ticket 3 changes how they are used, so that check is retired or loosened when ticket 3 starts, and
  the mockup checks (tokens, fonts, icons, 44 px) stay.
- **No change to the track format**: everything here is layout; `design` and `built` are untouched.
- **Branding**: tokens only (`tokens.json` via `theme/tokens.css`), Lucide icons (`mouse-pointer-2`, `plus`,
  `layout-grid`, `trash-2`, `undo-2`, `redo-2`, `box`, `ellipsis`, `save`, `send`, `sliders-horizontal`,
  `arrow-right-left`, `scan`, `pencil`, `circle-question-mark`, `chevron-left`, `x`, `circle-check`, `circle-x`,
  `triangle-alert`, `rotate-ccw`, `chevron-right`, `minus`), Inter and Oswald. Nothing new to the brand package
  (combustion-ops #11); when it lands, `tokens.css` is what it replaces.

## Quick mode on a phone (stage 2 idea)

Mockup: [`phone/05-quick-mode.html`](phone/05-quick-mode.html).

A 44 px steps row under the header. Step 1's plan is zoomed so a 2 m square is 56 px; the finger paints squares as
on the tablet, and when it comes within 48 px of an edge the plan scrolls under it at a steady rate (edge
auto-scroll), stopping when the finger moves back in. A mini-map, bottom right, shows the whole area, the squares
painted so far and the part on screen; tapping it jumps there. The ring on the first square closes the loop as now.
Step 1's toolbar: Start again · Undo · Redo · Zoom to fit · Shape it (enabled once the loop closes; the same move as the
desktop's automatic step change, made explicit so a finger lifting at the ring doesn't surprise). Step 2 is the stage
1 layout. The New track page gets a 375 px layout for venue, area and lane width in the same ticket.

## Build tickets

For the Board to approve, in build order. Stage 1 is tickets 1 to 7; stage 2 is 8 and 9.

1. **Designer: a layout shell** — pull the bar, palette, plan overlays and side panels out of `Designer.tsx` into
   components; `DesignerLayout` picks desktop / tablet / phone; no behaviour change; existing tests green.
2. **Designer: `Sheet` component** — peek / full / closed bottom sheet with grab bar, swipe and reduced motion;
   the tablet's floating sheet moves onto it.
3. **Designer on a phone: header, plan and bottom toolbar** — replaces the view-only screen below 640 px (and
   coarse pointers below 900 px) with the stage 1 layout; Select, Add point, Jump, Delete, Undo, Redo, 3D (lifting
   the phone exclusion of the 3D preview); checks pill; hint; scale bar; pinch and two-finger pan; the app header
   hidden.
4. **Designer on a phone: selection, Checks, Jump and How to draw sheets** — the four sheets on `Sheet`, with Show
   panning the plan, the stepper for the apex radius, and the Jump sheet arming the tool.
5. **Designer on a phone: overflow menu, save, submit and layout details** — the ⋯ menu; the save note and layout
   details as sheets; the blocked-Submit reason; the messages banner; Back.
6. **Designer: drag loupe** — the magnifier while a finger drags a corner, apex handle, jump or start line, on
   phones and tablets; the position in metres.
7. **Designer: long-press context sheet** — Delete (and the Advanced actions) from a long press on touch; no
   delete from the press itself (ADR 0005), with the touch guard added to Advanced's corner point too; the tablet's
   long press moves to it.
8. **Quick mode on a phone: lay the lanes** — zoomed grid, edge auto-scroll, mini-map, the steps row and step 1's
   toolbar, Shape it.
9. **New track page at 375 px** — venue, area and lane width on a phone, including the forum venue picker.
10. **Phone e2e suite** — Playwright at 375 × 812 with touch for tickets 3 to 8, in `apps/web/e2e`, on the touch
    helper; decide with the Board whether it joins `pnpm test`.

## Decisions for the Board

1. **3D on the toolbar, not in the overflow.** The issue lists it in both; it is a view you flip while editing, so
   the toolbar. The overflow has no 3D row.
2. **Jump on the toolbar.** The issue's toolbar list has no jumps; stage 1 needs them (change features), so a Jump
   button opens the Jump sheet. The alternative, jumps in the overflow, puts the second most used thing three taps
   away.
3. **Sheets sit above the toolbar**, which stays visible, so Undo and Delete are always one tap. The alternative
   (sheets cover the toolbar, with Delete in the sheet) gives sheets 64 px more room.
4. **Delete only on the toolbar**, not repeated in the selection sheet.
5. **The phone layout for coarse pointers up to 900 px**, which takes in portrait tablets; landscape 1024 px tablets
   keep the #16 layout.
6. **The checks pill opens Checks in both modes** on the phone, where #113 put Checks on the Advanced tab for the
   desktop. A phone has no tab to put it on, and stage 1 includes "run Checks".
