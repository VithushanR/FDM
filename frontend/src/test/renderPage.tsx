import { render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { RouteFocus, Shell } from "../App";
import { MapsProvider, type MapsAdapters } from "../maps/MapsContext";
import { AssessProvider } from "../state/assessStore";
import { FakeCanvas, FakeHotspotCanvas, fakeGeocoder, fakePlaceSearch, fakeRouteService } from "./fakeMaps";

// Shows the current query string, so tests can check what the page writes to the URL.
export function LocationProbe() {
  const { search } = useLocation();
  return <div data-testid="location-search">{search}</div>;
}

// Renders the real shell with fake maps. The Google provider is never mounted in tests.
export function renderPage(path = "/", adapters: Partial<MapsAdapters> = {}) {
  const value: MapsAdapters = {
    ready: true,
    placeSearch: fakePlaceSearch,
    geocoder: fakeGeocoder,
    routes: fakeRouteService,
    Canvas: FakeCanvas,
    HotspotCanvas: FakeHotspotCanvas,
    ...adapters,
  };
  return render(
    <MapsProvider value={value}>
      <AssessProvider>
        <MemoryRouter initialEntries={[path]}>
          <RouteFocus />
          <Shell />
          <LocationProbe />
        </MemoryRouter>
      </AssessProvider>
    </MapsProvider>,
  );
}
