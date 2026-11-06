// The build's version (#88): a hash of the built files' names, which carry their content hashes, so it changes exactly
// when the app does. Stamped into index.html as <meta name="app-version">; the server reads it from there and sends it
// on every API answer, and each tab compares it with its own.
import { createHash } from "node:crypto";
import type { Plugin } from "vite";

export function buildVersion(fileNames: string[]): string {
  const names = fileNames.filter((f) => f !== "index.html" && !f.endsWith(".map")).sort();
  return createHash("sha256").update(names.join("\n")).digest("hex").slice(0, 12);
}

export function stampVersion(html: string, version: string): string {
  if (!/<head>/.test(html)) throw new Error("index.html needs a <head> for the app version");
  return html.replace(/<head>/, `<head>\n    <meta name="app-version" content="${version}">`);
}

export function versionStamp(): Plugin {
  return {
    name: "track-studio-version",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html, ctx) => stampVersion(html, buildVersion(Object.keys(ctx.bundle ?? {}))),
    },
  };
}
