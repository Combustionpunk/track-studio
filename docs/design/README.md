# Track Studio design

The approved look for Track Studio v1 (#2, #3). Every UI ticket builds to these files. If a screen or state isn't covered here, follow `design-system.md` and say so in the PR.

## Files

| File | What it is |
|---|---|
| `design-system.md` | The brand book: voice, colour roles, plan and print palettes, type, spacing, iconography, component guidelines, quality bar. **Read first.** |
| `tokens.json` | Every token: colours (with usage notes), type scale, spacing, radii, sizes and shadows. The source of truth for values. Generate CSS custom properties from it (`--<name>`; font families as `--font-<key>`). |
| `components.css` | Reference CSS for the components (prefix `ts-`) and the plan drawing classes (prefix `p-`). Port it into the web app's styles; don't copy it blindly. |
| `assets/loop-mark.svg` | Placeholder logo mark for the header and favicon. |
| `mockups/*.dc.html` | One file per screen (below). |

## Mockups

| Screen | Desktop | Phone / tablet | Tickets |
|---|---|---|---|
| Library | `Main.dc.html` (1200px) | `Library375.dc.html` | #10 |
| Track page | `Track.dc.html` (1200px) | `Track375.dc.html` | #10, #9 |
| Designer, Quick mode | `Designer.dc.html` (1200px) | `DesignerTablet.dc.html` (1024 × 768), `Designer375.dc.html` (view only) | #11, #14, #15, #16 |
| Venue editor | `Venue.dc.html` (1200px) | `Venue375.dc.html` (read only) | #12 |
| Build sheet | `BuildSheet.dc.html` (A3 landscape, 1587 × 1123 at 96 dpi) | A4: same layout, scaled | #17 |
| Designer on a phone (plan, not built yet) | — | `../phone/01-plan-toolbar.html` to `05-quick-mode.html` (375 × 812), on `phone.css`; the plan is `../phone-designer.md` | #117 |

`Main.dc.html` is the library; the name comes from the design canvas.

### Reading a mockup

The mockups were drawn on a design canvas, so each file is HTML wrapped in canvas markup:

- The screen is everything inside `<x-dc>…</x-dc>`. Ignore `<script src="./support.js">`; read any `<script type="text/x-dc">` block at the end only as sample data.
- `<helmet>` holds the font link and page basics.
- `<sc-for list="{{tracks}}" as="t">` is a repeated row; the sample rows are in the `renderVals()` script at the bottom. `{{t.name}}` is a value from that row.
- `<sc-if value="{{…}}">` is a conditional block.
- Styles are inline, with literal hex values. Each one maps to a token in `tokens.json`; in code, always use the token, never the hex. For example, `#3d4147` is `bg`, `#fdd459` is `accent` and `#46564c` is `plan-carpet`.
- **Placeholders** (to keep these copies short):
  - `[undo-2]`, `[circle-check]` and the like are **Lucide icon names**: put that Lucide icon there.
  - `[tabletop symbol]` and similar are the jump symbols drawn in full in `Designer.dc.html`'s palette.
  - An empty `role="img"` box is a plan. The full plan drawing is in `Track.dc.html` (screen palette) and `BuildSheet.dc.html` (print palette); a comment beside each placeholder says what that view adds, such as corner handles or error marks.
  - `../assets/loop-mark.svg` is the logo mark.
- Track names, figures and positions are example content.
- Plans in the mockups are hand-drawn approximations. In the app, plans are drawn from `built` only (#9).

## Rules

- Colours from tokens only; Lucide icons only; Inter and Oswald self-hosted (#4).
- Screenshots at 1200px and 375px in every UI PR. Compare them with the matching mockup and note any differences.
- Empty, loading and error states follow the States patterns in `design-system.md` even where a mockup shows only the filled state.
