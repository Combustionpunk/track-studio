// The logo is one file, src/brand/logo.svg. The header shows it whole; the favicon is the same file cropped to its
// <view id="mark">, made here (served in dev, written to dist/favicon.svg by the build).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export const LOGO_FILE = fileURLToPath(new URL("./src/brand/logo.svg", import.meta.url));

/** The logo with its viewBox set to the "mark" view, at favicon size. */
export function faviconFromLogo(svg: string): string {
  const box = /<view id="mark" viewBox="([^"]+)"/.exec(svg)?.[1];
  if (!box) throw new Error('logo.svg needs a <view id="mark" viewBox="…"/> for the favicon');
  return svg
    .trim()
    .replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(?:width|height)="[^"]*"/g, "").replace(/\sviewBox="[^"]*"/, ` viewBox="${box}"`).replace(/>$/, ' width="32" height="32">'));
}

export function brand(): Plugin {
  const favicon = () => faviconFromLogo(readFileSync(LOGO_FILE, "utf8"));
  return {
    name: "track-studio-brand",
    configureServer(server) {
      server.watcher.add(LOGO_FILE);
      server.middlewares.use("/favicon.svg", (_req, res) => {
        res.setHeader("content-type", "image/svg+xml");
        res.setHeader("cache-control", "no-cache");
        res.end(favicon());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "favicon.svg", source: favicon() });
    },
  };
}
