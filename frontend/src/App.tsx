import { APIProvider } from "@vis.gl/react-google-maps";
import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AboutPage } from "./pages/AboutPage";
import { AssessPage } from "./pages/AssessPage";
import { HotspotsPage } from "./pages/HotspotsPage";
import { MapsProvider, googleAdapters, type MapsAdapters } from "./maps/MapsContext";
import { AssessProvider } from "./state/assessStore";

declare global {
  interface Window {
    // Google calls this when the key is refused. The page then falls back to coordinate inputs.
    gm_authFailure?: () => void;
  }
}

const API_KEY: string = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "");

const TITLES: Record<string, string> = {
  "/": "Assess a collision",
  "/hotspots": "Hotspots",
  "/about": "About",
};

export function RouteFocus() {
  const { pathname } = useLocation();
  useEffect(() => {
    const title = TITLES[pathname] ?? "Page not found";
    document.title = `${title} | Road safety estimator`;
    document.getElementById("page-heading")?.focus();
  }, [pathname]);
  return null;
}

function useMapsAdapters(): MapsAdapters {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    window.gm_authFailure = () => { setFailed(true); };
    return () => {
      delete window.gm_authFailure;
    };
  }, []);
  if (!API_KEY || failed) {
    return { ready: false, placeSearch: null, geocoder: null, routes: null, Canvas: null, HotspotCanvas: null };
  }
  return googleAdapters;
}

export function Shell() {
  return (
    <>
      <header className="site-nav">
        <div className="site-nav-inner">
          <span className="site-brand">Road safety estimator</span>
          <nav aria-label="Main">
            <ul className="site-tabs">
              <li>
                <NavLink to="/" end>
                  Assess
                </NavLink>
              </li>
              <li>
                <NavLink to="/hotspots">Hotspots</NavLink>
              </li>
              <li>
                <NavLink to="/about">About</NavLink>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <main id="main" className="page" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<AssessPage />} />
          <Route path="/hotspots" element={<HotspotsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route
            path="*"
            element={
              <div>
                <h1 id="page-heading" tabIndex={-1}>
                  Page not found
                </h1>
              </div>
            }
          />
        </Routes>
      </main>
    </>
  );
}

export function App() {
  const adapters = useMapsAdapters();
  const shell = (
    <MapsProvider value={adapters}>
      <AssessProvider>
        <BrowserRouter>
          <RouteFocus />
          <Shell />
        </BrowserRouter>
      </AssessProvider>
    </MapsProvider>
  );
  return API_KEY ? <APIProvider apiKey={API_KEY}>{shell}</APIProvider> : shell;
}
