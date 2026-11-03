// Fonts for the pictures the server renders with resvg. resvg can't use the weight axis of the web app's variable
// Inter and Oswald, so the server has its own static TrueType files (apps/server/fonts: Google Fonts' Latin and Latin
// Extended instances, SIL OFL), one per weight the card uses. DejaVu Sans is always there as the fallback, so a picture
// still has text if the folder is missing.
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { ROOT_DIR } from "./config.js";

export const SERVER_FONTS_DIR = join(ROOT_DIR, "apps", "server", "fonts");
export const FALLBACK_FONT = join(dirname(createRequire(import.meta.url).resolve("dejavu-fonts-ttf/package.json")), "ttf", "DejaVuSans.ttf");

/** The TrueType files in `dir` (sorted), then the fallback. */
export function loadFonts(dir = SERVER_FONTS_DIR): string[] {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ttf")).sort().map((f) => join(dir, f)) : [];
  return [...files, FALLBACK_FONT];
}

const fonts = loadFonts();

/** Font files for resvg: Inter and Oswald, then the fallback. */
export const previewFontFiles = () => fonts;

/** Which fonts pictures are drawn with: part of every picture's hash, so they refresh when the fonts change. */
export const fontsKey = () => previewFontFiles().map((f) => f.split(/[\\/]/).pop()).join(",");
