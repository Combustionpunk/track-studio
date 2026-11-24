// The user guide's screenshots (#171): docs/guide/img/*.png. The build reads each one's size from its PNG header and
// hands them to the app as `virtual:guide-image-sizes`, so /help can give every <img> its width and height and the
// page doesn't jump as screenshots load (a jump would move the section a "?" link has just scrolled to).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export const GUIDE_IMG_DIR = fileURLToPath(new URL("../../docs/guide/img/", import.meta.url));
const ID = "virtual:guide-image-sizes";

/** width and height from a PNG's IHDR chunk */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || view.getUint32(0) !== 0x89504e47 || view.getUint32(12) !== 0x49484452) throw new Error("not a PNG");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function guideImageSizes(dir = GUIDE_IMG_DIR): Record<string, { width: number; height: number }> {
  const out: Record<string, { width: number; height: number }> = {};
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".png")).sort()) out[name] = pngSize(readFileSync(join(dir, name)));
  return out;
}

export function guideImages(): Plugin {
  return {
    name: "track-studio-guide-images",
    resolveId: (id) => (id === ID ? `\0${ID}` : undefined),
    load(id) {
      if (id !== `\0${ID}`) return;
      this.addWatchFile(GUIDE_IMG_DIR);
      return `export default ${JSON.stringify(guideImageSizes())};`;
    },
  };
}
