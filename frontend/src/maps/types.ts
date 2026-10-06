// Small interfaces the app depends on. Google implementations live in google.ts and the canvas files; tests use fakes.
import type { HotspotOut } from "../api/hotspotContract";
import type { Bounds } from "../state/hotspotState";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlaceSuggestion {
  placeId: string;
  text: string;
}

export interface PlaceSearch {
  suggest(query: string, sessionToken: string, signal?: AbortSignal): Promise<PlaceSuggestion[]>;
  resolve(placeId: string, sessionToken: string): Promise<{ location: LatLng; name: string } | null>;
}

export interface Geocoder {
  reverse(point: LatLng): Promise<string | null>;
}

export interface RouteAlternative {
  name: string;
  distanceM: number;
  durationS: number;
  path: LatLng[];
}

export interface RouteService {
  // Driving alternatives, up to three. Rejects when the Routes call fails.
  alternatives(origin: LatLng, destination: LatLng, signal?: AbortSignal): Promise<RouteAlternative[]>;
}

export type PinStatus = "covered" | "sparse" | "outside" | "unchecked" | "none";

export interface MapCanvasProps {
  center: LatLng;
  zoom: number;
  pin: LatLng | null;
  pinStatus: PinStatus;
  restrictToGreatBritain: boolean;
  // Hotspots drawn as circles around the pin, already limited by the caller.
  hotspots: HotspotOut[];
  onPick: (point: LatLng) => void;
  onPinDragEnd: (point: LatLng) => void;
  onMap?: (controls: MapControls) => void;
}

export interface MapControls {
  zoomBy: (delta: number) => void;
}

export interface ViewState {
  center: LatLng;
  zoom: number;
  bounds: Bounds;
}

// A pan or zoom request from the page. A new key means a new request, even to the same place.
export interface MapTarget {
  center: LatLng;
  zoom: number;
  key: number;
}

export interface RouteOverlay {
  id: string;
  letter: string;
  path: LatLng[];
  selected: boolean;
  start: LatLng | null;
  end: LatLng | null;
}

export interface HotspotCanvasProps {
  initialCenter: LatLng;
  initialZoom: number;
  // The hotspots to draw: already in view, and limited by zoom.
  hotspots: HotspotOut[];
  selectedId: number | null;
  target: MapTarget | null;
  routes: RouteOverlay[];
  // Fit the map to these bounds the first time it loads, when set. Used by the route check.
  fitRoutes: boolean;
  onViewChange: (view: ViewState) => void;
  onSelect: (id: number) => void;
  onHover: (id: number | null) => void;
  onMap?: (controls: MapControls) => void;
}
