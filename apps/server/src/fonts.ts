// Fonts for the pictures the server renders with resvg. Inter and Oswald are the web app's own self-hosted woff2 files
// (apps/web/src/theme/fonts); resvg reads TrueType only, so they're unpacked once into DATA_DIR/fonts. DejaVu Sans is
// always there as the fallback, so a picture still has text if the web fonts are missing.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import woff2 from "wawoff2";
import { ROOT_DIR } from "./config.js";

export const WEB_FONTS_DIR = join(ROOT_DIR, "apps", "web", "src", "theme", "fonts");
export const FALLBACK_FONT = join(dirname(createRequire(import.meta.url).resolve("dejavu-fonts-ttf/package.json")), "ttf", "DejaVuSans.ttf");

let prepared: string[] = [];

/** Unpack the web fonts (Latin and Latin Extended files) to TrueType in `dataDir`/fonts; returns their paths. */
export async function prepareFonts(dataDir: string, from = WEB_FONTS_DIR): Promise<string[]> {
  if (!existsSync(from)) return (prepared = []);
  const out = join(dataDir, "fonts");
  mkdirSync(out, { recursive: true });
  const files: string[] = [];
  // basic Latin first: the Latin Extended subsets share the family name, and resvg uses the first face it finds
  const order = (f: string) => (f.includes("-ext") ? 1 : 0);
  for (const f of readdirSync(from).filter((f) => f.endsWith(".woff2")).sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
    const ttf = join(out, f.replace(/\.woff2$/, ".ttf"));
    if (!existsSync(ttf)) {
      const tmp = `${ttf}.${process.pid}.tmp`;
      writeFileSync(tmp, await woff2.decompress(readFileSync(join(from, f))));
      renameSync(tmp, ttf);
    }
    files.push(ttf);
  }
  return (prepared = files);
}

/** Font files for resvg: the prepared web fonts, then the fallback. */
export const previewFontFiles = () => [...prepared, FALLBACK_FONT];

/** Which fonts pictures are drawn with: part of every picture's hash, so they refresh when the fonts change. */
export const fontsKey = () => previewFontFiles().map((f) => f.split(/[\\/]/).pop()).join(",");
