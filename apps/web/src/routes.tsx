// The app's routes. A pathless root runs the version gate before each change of page (#88), and every route has the
// app's own error page above it: pages inside the site chrome keep the header when they fail.
import { lazy, Suspense, useEffect } from "react";
import { Outlet, useLocation, useParams, type RouteObject } from "react-router-dom";
import { EditTrackPage, NewDesignPage, NewTrackPage } from "./designer/pages.js";
import { Header } from "./components/Header.js";
import { UpdateBanner } from "./components/UpdateBanner.js";
import { BuildSheetPage } from "./pages/BuildSheet.js";
import { Embed } from "./pages/Embed.js";
import { RouteError } from "./pages/ErrorPage.js";
import { LapSpeeds } from "./pages/LapSpeeds.js";
import { Library } from "./pages/Library.js";
import { NotFound } from "./pages/NotFound.js";
import { TrackPage } from "./pages/TrackPage.js";
import { VenuePage, Venues } from "./pages/Venues.js";
import { gateRevalidates, useCheckOnFocus, versionGate } from "./lib/version.js";
import { EditVenuePage, NewVenuePage } from "./venues/pages.js";

/** development only (#121): a production build drops the import, so it ships no demo chunk */
const SheetDemo = import.meta.env.DEV ? lazy(() => import("./pages/SheetDemo.js").then((m) => ({ default: m.SheetDemo }))) : null;

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
      <UpdateBanner />
      <main id="main">
        <Outlet />
      </main>
    </>
  );
}

/** The root: checks the version when the tab regains focus, on every page including the embed and the build sheet. */
export function VersionWatch() {
  useCheckOnFocus();
  return <Outlet />;
}

/** A fresh page per track, so panels and selections don't carry over from the previous one. */
function TrackRoute() {
  const { id } = useParams();
  return <TrackPage key={id} />;
}

export const routes: RouteObject[] = [
  {
    element: <VersionWatch />,
    loader: versionGate,
    shouldRevalidate: gateRevalidates,
    errorElement: <RouteError />,
    hydrateFallbackElement: null,
    children: [
      // the embed has no site chrome
      { path: "/embed/:id", element: <Embed /> },
      // the build sheet prints without the site's chrome
      { path: "/t/:id/build", element: <BuildSheetPage /> },
      // development only: a page to try the phone's bottom sheet on (#121); production builds leave it out
      ...(SheetDemo ? [{ path: "/dev/sheet", element: <Suspense><SheetDemo /></Suspense> }] : []),
      {
        element: <Layout />,
        children: [
          {
            errorElement: <RouteError />,
            children: [
              { path: "/", element: <Library /> },
              { path: "/t/:id", element: <TrackRoute /> },
              { path: "/t/:id/edit", element: <EditTrackPage /> },
              { path: "/new", element: <NewTrackPage /> },
              { path: "/new/design", element: <NewDesignPage /> },
              { path: "/v", element: <Venues /> },
              { path: "/v/new", element: <NewVenuePage /> },
              { path: "/v/:id", element: <VenuePage /> },
              { path: "/v/:id/edit", element: <EditVenuePage /> },
              { path: "/lap-speeds", element: <LapSpeeds /> },
              { path: "*", element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
];
