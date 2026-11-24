// The user guide's screenshots (#171): docs/guide/img/*.webp. The build reads each one's size from its header and
// hands them to the app as `virtual:guide-image-sizes`, so /help can give every <img> its width and height and the
// page doesn't jump as screenshots load (a jump would move the section a "?" link has just scrolled to).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export const GUIDE_IMG_DIR = fileURLToPath(new URL("../../docs/guide/img/", import.meta.url));
const ID = "virtual:guide-image-sizes";

/**
 * Width and height of a WebP picture, from its first chunk: lossy (VP8), lossless (VP8L) or extended (VP8X).
 * apps/web/scripts/guide-shots.mjs writes lossy ones.
 */
export function webpSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 30 || tag(0) !== "RIFF" || tag(8) !== "WEBP") throw new Error("not a WebP picture");
  const chunk = tag(12);
  if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: (view.getUint32(24, true) & 0xffffff) + 1, height: (view.getUint32(27, true) & 0xffffff) + 1 };
  throw new Error(`a WebP picture of a kind this doesn't read (${chunk})`);
}

export function guideImageSizes(dir = GUIDE_IMG_DIR): Record<string, { width: number; height: number }> {
  const out: Record<string, { width: number; height: number }> = {};
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".webp")).sort()) out[name] = webpSize(readFileSync(join(dir, name)));
  return out;
}

export function guideImages(): Plugin {
  return {
    name: "track-studio-guide-images",
    resolveId: (id) => (id === ID ? `\0${ID}` : undefined),
    load(id) {
      if (id !== `\0${ID}`) return;
      // read once per build or dev-server start: restart `pnpm dev` after adding a screenshot
      return `export default ${JSON.stringify(guideImageSizes())};`;
    },
  };
}
