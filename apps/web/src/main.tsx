import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider, useLocation, useParams } from "react-router-dom";
import { EditTrackPage, NewDesignPage, NewTrackPage } from "./designer/pages.js";
import { Header } from "./components/Header.js";
import { SessionProvider } from "./lib/session.js";
import { Embed } from "./pages/Embed.js";
import { Library } from "./pages/Library.js";
import { NotFound } from "./pages/NotFound.js";
import { TrackPage } from "./pages/TrackPage.js";
import { VenuePage, Venues } from "./pages/Venues.js";
import "./styles.css";

function Layout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Outlet />
      </main>
    </>
  );
}

/** A fresh page per track, so panels and selections don't carry over from the previous one. */
function TrackRoute() {
  const { id } = useParams();
  return <TrackPage key={id} />;
}

const router = createBrowserRouter([
  // the embed has no site chrome
  { path: "/embed/:id", element: <Embed /> },
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Library /> },
      { path: "/t/:id", element: <TrackRoute /> },
      { path: "/t/:id/edit", element: <EditTrackPage /> },
      { path: "/new", element: <NewTrackPage /> },
      { path: "/new/design", element: <NewDesignPage /> },
      { path: "/v", element: <Venues /> },
      { path: "/v/:id", element: <VenuePage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const root = document.getElementById("root")!;
root.textContent = ""; // drop the server's no-script fallback before React takes over
createRoot(root).render(
  <StrictMode>
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  </StrictMode>,
);
