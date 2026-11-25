// The app's links into the user guide (#171): Help in the menu and the "?" links. One list, so a test can check that
// every anchor is a heading in docs/guide/README.md (apps/web/test/help.test.tsx). Change a heading there and the
// anchor here together.
export const HELP_TOPICS = {
  /** Help in the menu: the guide from the top */
  guide: { anchor: "", label: "Help: the user guide" },
  /** the designer's palette: jumps, cones, Add point, the start line */
  palette: { anchor: "draw-the-track", label: "Help with drawing the track" },
  /** the fit check: "Check against a venue" in the designer, "Fit to a venue" on a track's page */
  fit: { anchor: "the-fit-check", label: "Help with the fit check" },
  /** the build sheet */
  build: { anchor: "the-build-sheet", label: "Help with the build sheet" },
  /** the designer on a tablet or phone */
  touch: { anchor: "on-a-tablet-or-phone", label: "Help with drawing on a tablet or phone" },
} as const;

export type HelpTopic = keyof typeof HELP_TOPICS;

export const HELP_PATH = "/help";

export function helpHref(topic: HelpTopic = "guide"): string {
  const anchor = HELP_TOPICS[topic].anchor;
  return anchor ? `${HELP_PATH}#${anchor}` : HELP_PATH;
}
