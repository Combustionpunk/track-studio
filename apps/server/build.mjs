// Bundles the server (and the workspace engine, which ships as TypeScript source) into dist/.
// Packages with native code or runtime file lookups stay external and come from node_modules.
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts", "src/seed.ts", "src/rebake.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  external: ["better-sqlite3", "@resvg/resvg-js", "dejavu-fonts-ttf", "fastify", "@fastify/cookie", "@fastify/static", "@fastify/middie", "dotenv", "vite"],
  // CommonJS dependencies bundled into ESM still call require()
  banner: { js: "import { createRequire as __tsCreateRequire } from 'node:module'; const require = __tsCreateRequire(import.meta.url);" },
  logLevel: "info",
});
