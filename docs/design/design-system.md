# Track Studio design system

Track Studio is where RC Misfits members design carpet tracks, organisers keep their halls' venue templates, and marshals print the sheet they lay a track out from. It should feel like part of the RC Misfits family (the forum, the booking pages, the sim), not a bolt-on: the same colours, the same fonts, the same plain voice.

This is the reference every Track Studio UI ticket builds to (#3). Values are in `tokens.json`; reference CSS is in `components.css`; screens are in `mockups/`. Decisions behind it are in #2.

## Voice

Plain and friendly, like a club member who knows the software explaining it at the track.

- Name things the way racers do: lane, pipe, corner, jump, rostrum, start line, lap. Not "segment", "polyline" or "feature".
- Measurements in metres, one decimal for lengths ("38.4 m"), whole numbers for counts ("12 corners"). Never feet or pixels.
- Buttons say what happens: "Submit track", "Make my own copy", "Open build sheet".
- Errors say what is wrong, where, and what to do: "Lane runs outside the track area at corner 7." No apologies, no jokes.
- Club humour lives only in empty states ("No tracks fit this hall yet. Draw one and be the first."). Never in errors, checks or the build sheet.
- No emoji in the interface.

## Colour

Track Studio's interface colours follow the forum's colour scheme. The server reads the forum's public `site.json` at start and hourly and maps the Discourse colour roles onto these tokens (#4); the values in `tokens.json` are the built-in fallback, the forum's current **Grey Amber** scheme. It is a dark scheme, so Track Studio is dark by default. If the forum ever adds a light scheme, Track Studio follows the device's `prefers-color-scheme` between them.

| Token | Forum role | Use |
| --- | --- | --- |
| `bg` | secondary | Page background |
| `bg-raised` | derived | Cards, panels, designer toolbar |
| `bg-sunken` | selected | Inputs, the plan well |
| `header`, `header-text` | header_background, header_primary | The app header band |
| `text` | primary | Body text (7.3:1 on `bg`) |
| `text-muted` | derived | Metadata and help (5.6:1 on `bg`) |
| `line`, `line-strong` | derived | Hairlines; control borders (3.4:1) |
| `accent`, `on-accent` | tertiary, highlight | Primary buttons, links, selection, warnings |
| `danger`, `danger-text`, `on-danger` | danger | Danger fills; error words; text on danger |
| `positive` | Track Studio's own | Approved and passed checks |

Rules:

- One accent. Amber marks the main action, the current place and warnings; nothing decorative is amber.
- The forum's `danger` (#e45735) is only 2.8:1 on `bg`, so it is used as a fill or a mark, never for words. Error words use `danger-text`.
- The forum's success colour is the same amber as warnings, so Track Studio adds `positive` (green) for Approved and passed checks. Status never relies on colour alone: the word is always there.
- Derived shades are blends of `text` over `bg`, the way Discourse derives its own, so they move with the forum's scheme.
- Contrast checked on every pair named in the token notes: text 4.5:1 or better, control borders, focus ring and icons 3:1 or better.

## Plan colours (fixed)

The plan is what people see everywhere: library cards, the track page, the forum embed, the link preview image and the designer. It is drawn from `built` only and uses its own fixed palette (`plan-*` tokens), which never follows the forum, so a plan looks the same in every place it appears.

- Hall floor `plan-floor`, track area `plan-area`, carpet `plan-carpet` with a subtle texture.
- Pipes `plan-pipe` at real thickness; a shared pipe carries a `plan-pipe-shared` core line.
- Racing line `plan-line`, dashed, with direction chevrons.
- Jumps `plan-jump` with a `plan-jump-edge` outline; the darker edge is the take-off.
- Rostrum `plan-rostrum`, obstacles `plan-obstacle`, start line chequered in pipe and floor colours.
- Grid every metre in `plan-grid`, every 5 m in `plan-grid-major`, with a scale bar in metres.
- Problems: error sections as a 3px `plan-error` overlay on the lane, warnings as a `plan-warning` ring on the corner or jump.

## Print colours (fixed)

The build sheet is a light, print-friendly page (A3 landscape by default, A4 offered) that marshals lay the track out from. It uses the `print-*` tokens: black ink on white, a pale carpet tint, a 1 m grid with bolder 5 m lines, and hatched jumps with ink outlines so it reads in black and white. Positions are measured from the south-west corner of the track area ("4.0 m from the west wall, 2.5 m from the south wall"). A `print-watermark` DRAFT runs across it until the track is approved. Mockup: `mockups/BuildSheet.dc.html`.

## Type

The same pair as the forum: **Oswald** for headings and figures, **Inter** for everything read. Both are self-hosted in the app as woff2 with system fallbacks (#4).

- `title` 32px, `heading` 22px, `card-title` 20px: Oswald 500, sentence case for track and venue names as their authors wrote them.
- `figure` 28px and `figure-sm` 18px: Oswald with tabular numbers, for lap length, corners, size and timings.
- `body` 15px, `body-sm` 13px, `control` 14px semibold, `label` 11px uppercase with letter-spacing: Inter.
- `code` 13px mono for check codes in Advanced mode only.

## Space and shape

- A 4px base: `space-1` to `space-12`. Page gutter `space-4` on phones, `space-6` on desktop.
- Small radii, like the forum: `radius-sm` for inputs and check rows, `radius-md` for buttons and cards, `radius-lg` for panels and the plan well. Pills (`radius-full`) are for status badges only.
- Controls are 36px tall with a mouse; every control in a tablet layout meets the 44px `touch-target`.
- Flat surfaces separated by `line`; only floating things (menus, toasts, the snap indicator) get `shadow-float`.
- Keyboard focus is always visible: `focus-ring`, a 2px gap then 2px of accent.

## Iconography

- **Lucide** icons only, at 16px in text and 20px in toolbars, stroke 2, coloured with the text they sit beside.
- Plan symbols (jumps, rostrum, start line) are drawn shapes in the plan palette, never Lucide icons.
- Icon-only buttons always have an `aria-label`.

## Logo

A placeholder until the real RC Misfits logo files arrive: `assets/loop-mark.svg` (a track loop on the header colour: carpet, pipes and an amber racing line; fixed colours, used at 32px in the header and as the favicon) beside an Oswald wordmark, "RC MISFITS" in 600 with "TRACK STUDIO" in accent. The mark is one replaceable file.

## Components

Reference CSS in `components.css` (prefix `ts-`); the web app builds React components on the same rules.

### Button

One primary button per view, everything else secondary or quiet.

- **Primary** (`ts-btn--primary`): the one main action: Submit track, Save venue, Approve. Accent fill, `on-accent` label.
- **Secondary** (`ts-btn`): other actions: Make my own copy, Download, Fit to a venue.
- **Quiet** (`ts-btn--quiet`): toolbar and table actions; icon-only ones (`ts-btn--icon`) need an `aria-label`.
- **Danger** (`ts-btn--danger`): Archive and Delete, always behind a confirmation in the page.
- **Touch** (`ts-btn--touch`): the 44px `touch-target` minimum for tablet layouts, for example undo, redo and zoom-to-fit in the designer.

Labels say exactly what happens, in sentence case: "Submit track", not "OK". A disabled Submit carries a line beside it saying what to fix.

### Input

Text, number and select fields, with an uppercase label above and help or an error below.

- Wrap each control in `ts-field` with a `ts-label` and, when needed, `ts-help`. Give the label a `for` and the input an `id`.
- Measurements always show their unit beside the field (`ts-unit`): metres only (`docs/rctrack-SPEC.md`).
- An invalid field gets `ts-input--invalid` and `ts-help--error` saying what to change: "Width must be at least 6 m."
- Inputs sit on `bg-sunken` with `line-strong` borders, which pass 3:1 as control borders.

### StatusBadge

Where a track is in its life: draft, submitted, approved or archived.

- `ts-badge` alone is **Draft**; add `--submitted`, `--approved` or `--archived`.
- The word always shows; colour only backs it up.
- Pills are reserved for status. Nothing else uses `radius-full`.

### TrackCard

A track in the library: its plan, name, status and three figures, linking to the track page.

- The plan comes from `built` only, drawn with the fixed plan palette.
- Name in `card-title`; figures in `figure-sm` with tabular numbers: lap length to one decimal, corner count, track size as length × width in metres.
- Metadata line: author, venue and revision, in `text-muted`.
- The whole card is one link; hover strengthens the border, focus shows the focus ring.
- Cards sit in a grid that wraps to one column at 375px.

### ChecksList

The engine's live checks, in plain words, with a way to jump to the problem on the plan.

- Errors (`ts-check--error`) block Submit; warnings (`ts-check--warning`) never do; info is hidden in Quick mode.
- Each row says what is wrong and where ("Lane runs outside the track area at corner 7"), with a "Show" action that selects that spot on the plan.
- Quick mode shows a one-line summary and the rows; Advanced adds the check code in `code` style.
- The same problems are drawn on the plan: errors as a `plan-error` overlay, warnings as a `plan-warning` ring.
- When everything passes, one `ts-check--ok` row: "No problems. Ready to submit."

### States

Empty, loading and error states, designed for every list and page.

- **Empty** (`ts-empty`): what will appear here and how to add the first one, with one button. Club humour is allowed here and only here.
- **Loading** (`ts-skeleton`): blocks in the shape of what is coming, sized to the final layout so nothing shifts. The pulse stops under `prefers-reduced-motion`.
- **Error** (`ts-alert`): what went wrong and what to do next, plainly. No humour, no apologies. Example: "Couldn't save revision 5. The server didn't answer. Your changes are kept in this browser; try Save again in a moment."

### AppHeader

The header band on every page: mark, wordmark, navigation and the signed-in user.

- Uses `header` and `header-text`, the forum's own header colours, so moving between the forum and Track Studio feels like one site.
- The current page has an accent underline and `aria-current="page"`.
- At 375px the navigation collapses behind a 44px menu button.

### PlanKey

The symbols every plan uses, in the fixed plan palette (`p-*` classes in `components.css`): carpet and pipes, shared pipe, racing line, jump, rostrum, obstacle, start line, error section, warning ring. The build sheet uses the same symbols in the print palette, with hatching on jumps.

## Quality bar (every UI ticket)

Screenshots at 1200px and 375px in the PR; designed empty, loading and error states; visible keyboard focus; WCAG AA contrast; no layout shift; Lucide icons only; colours from tokens only; matches the approved mockup.
