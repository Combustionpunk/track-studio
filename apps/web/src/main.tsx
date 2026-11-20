import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { SessionProvider, useSession, withoutNoSignin } from "./lib/session.js";
import { chooseTheme, ThemeProvider } from "./lib/theme.js";
import { onPreloadError } from "./lib/version.js";
import { routes } from "./routes.js";
import "./styles.css";

// a lazy chunk's preload failed (a deploy removed it): reload once per version, never over unsaved work and never
// without session storage; otherwise the import's own error reaches the route's error page, so it can't loop (#88, #90)
window.addEventListener("vite:preloadError", (e) => onPreloadError(e));

// the server marks the address when a browser came back from a silent sign-in without its cookie (#132): off the address bar
const clean = withoutNoSignin(window.location.search);
if (clean !== window.location.search) window.history.replaceState(window.history.state, "", `${window.location.pathname}${clean}${window.location.hash}`);

const router = createBrowserRouter(routes);

/** The member's theme from the forum (#135, #141), else Pit Lane. A page has no club yet, so there is no club theme to fall back on. */
function MemberTheme({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  return <ThemeProvider theme={chooseTheme(me?.theme, undefined)}>{children}</ThemeProvider>;
}

const root = document.getElementById("root")!;
root.textContent = ""; // drop the server's no-script fallback before React takes over
createRoot(root).render(
  <StrictMode>
    <SessionProvider>
      <MemberTheme>
        <RouterProvider router={router} />
      </MemberTheme>
    </SessionProvider>
  </StrictMode>,
);
