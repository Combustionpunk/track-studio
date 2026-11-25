import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { brand } from "./brand.js";
import { guideImages } from "./guide-images.js";
import { versionStamp } from "./version-stamp.js";

// In development the app runs inside the Fastify server (Vite middleware mode, `pnpm dev`), so the API, the login
// callback and the pages share one origin. `vite build` writes dist/, which the server serves in production.
// brand(): the favicon is made from src/brand/logo.svg (the one logo file). versionStamp(): the build's version in
// index.html, which the server reports on every API answer so open tabs notice a deploy (#88). guideImages(): the sizes
// of the user guide's screenshots (docs/guide/img), for /help (#171).
export default defineConfig({
  plugins: [react(), brand(), guideImages(), versionStamp()],
  build: { outDir: "dist", assetsDir: "assets", sourcemap: true },
});
