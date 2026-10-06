import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import { GoogleMapCanvas } from "./GoogleMapCanvas";
import { GoogleHotspotCanvas } from "./GoogleHotspotCanvas";
import { googleGeocoder, googlePlaceSearch, googleRouteService } from "./google";
import type { Geocoder, HotspotCanvasProps, MapCanvasProps, PlaceSearch, RouteService } from "./types";

export interface MapsAdapters {
  // False when there is no key, or the Maps script failed. Pages then show their fallback.
  ready: boolean;
  placeSearch: PlaceSearch | null;
  geocoder: Geocoder | null;
  routes: RouteService | null;
  Canvas: ComponentType<MapCanvasProps> | null;
  HotspotCanvas: ComponentType<HotspotCanvasProps> | null;
}

export const googleAdapters: MapsAdapters = {
  ready: true,
  placeSearch: googlePlaceSearch,
  geocoder: googleGeocoder,
  routes: googleRouteService,
  Canvas: GoogleMapCanvas,
  HotspotCanvas: GoogleHotspotCanvas,
};

const MapsContext = createContext<MapsAdapters>(googleAdapters);

export function MapsProvider({ value, children }: { value?: MapsAdapters; children: ReactNode }) {
  return <MapsContext.Provider value={value ?? googleAdapters}>{children}</MapsContext.Provider>;
}

export function useMaps(): MapsAdapters {
  return useContext(MapsContext);
}
