import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the app runs inside the Fastify server (Vite middleware mode, `pnpm dev`), so the API, the login
// callback and the pages share one origin. `vite build` writes dist/, which the server serves in production.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", assetsDir: "assets", sourcemap: true },
});
