import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { SessionProvider } from "./lib/session.js";
import { reloadOnceForChunkError } from "./lib/version.js";
import { routes } from "./routes.js";
import "./styles.css";

// a lazy chunk's preload failed (a deploy removed it): reload once per version; after that the import's own error
// reaches the route's error page, so it can't loop (#88)
window.addEventListener("vite:preloadError", (e) => {
  if (reloadOnceForChunkError()) e.preventDefault();
});

const router = createBrowserRouter(routes);

const root = document.getElementById("root")!;
root.textContent = ""; // drop the server's no-script fallback before React takes over
createRoot(root).render(
  <StrictMode>
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  </StrictMode>,
);
