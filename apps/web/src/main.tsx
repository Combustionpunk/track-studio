import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
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

function App() {
  return (
    <Routes>
      {/* the embed has no site chrome */}
      <Route path="/embed/:id" element={<Embed />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Library />} />
        <Route path="/t/:id" element={<TrackRoute />} />
        <Route path="/v" element={<Venues />} />
        <Route path="/v/:id" element={<VenuePage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

const root = document.getElementById("root")!;
root.textContent = ""; // drop the server's no-script fallback before React takes over
createRoot(root).render(
  <StrictMode>
    <SessionProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>,
);
