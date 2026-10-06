import { useEffect } from "react";
import type { RouteAlternative, RouteService, Geocoder, HotspotCanvasProps, LatLng, MapCanvasProps, PlaceSearch, ViewState } from "../maps/types";

export const LONDON: LatLng = { lat: 51.5074, lng: -0.1278 };
export const BELFAST: LatLng = { lat: 54.597, lng: -5.93 };

// Stands in for the Google map. Buttons play the part of clicks and drags.
export function FakeCanvas({ pin, pinStatus, hotspots, onPick, onPinDragEnd }: MapCanvasProps) {
  return (
    <div data-testid="fake-canvas" data-pin={pin ? "yes" : "no"} data-pin-status={pinStatus} data-nearby={hotspots.length}>
      <button type="button" onClick={() => {
        onPick(LONDON);
      }}>
        Click London
      </button>
      <button type="button" onClick={() => {
        onPick(BELFAST);
      }}>
        Click Belfast
      </button>
      <button type="button">Start drag</button>
      <button type="button" onClick={() => {
        onPinDragEnd(BELFAST);
      }}>
        End drag at Belfast
      </button>
    </div>
  );
}

// The whole of Great Britain, as the map reports it on load.
export const GB_VIEW: ViewState = {
  center: { lat: 54.5, lng: -3 },
  zoom: 6,
  bounds: { north: 61, south: 49, east: 2.5, west: -9 },
};

// Scotland only, for testing the viewport filter.
export const SCOTLAND_VIEW: ViewState = {
  center: { lat: 57.5, lng: -4 },
  zoom: 6,
  bounds: { north: 61, south: 56, east: 2, west: -8 },
};

// Stands in for the Google hotspot map. It reports GB on load, and exposes the selection and routes for assertions.
export function FakeHotspotCanvas({ hotspots, selectedId, routes, onViewChange, onSelect }: HotspotCanvasProps) {
  useEffect(() => {
    onViewChange(GB_VIEW);
  }, [onViewChange]);
  return (
    <div
      data-testid="fake-hotspot-canvas"
      data-count={hotspots.length}
      data-selected={selectedId ?? ""}
      data-routes={routes.map((route) => `${route.letter}${route.selected ? "*" : ""}`).join(",")}
    >
      <button type="button" onClick={() => {
        onViewChange(SCOTLAND_VIEW);
      }}>
        View Scotland
      </button>
      {hotspots.slice(0, 3).map((hotspot) => (
        <button key={hotspot.id} type="button" onClick={() => {
          onSelect(hotspot.id);
        }}>
          Select on map {hotspot.id}
        </button>
      ))}
    </div>
  );
}

export const fakePlaceSearch: PlaceSearch = {
  suggest: (query: string) =>
    Promise.resolve(query.length >= 3 ? [{ placeId: "place-1", text: "Big Ben, London" }] : []),
  resolve: () => Promise.resolve({ location: { lat: 51.5007, lng: -0.1246 }, name: "Big Ben" }),
};

export const fakeGeocoder: Geocoder = {
  reverse: () => Promise.resolve("Central London"),
};

// Two driving alternatives between two points: a short straight one and a longer one.
export const fakeRouteService: RouteService = {
  alternatives: (origin: LatLng, destination: LatLng): Promise<RouteAlternative[]> =>
    Promise.resolve([
      {
        name: "M1 and A57",
        distanceM: 48000,
        durationS: 2700,
        path: [origin, { lat: (origin.lat + destination.lat) / 2, lng: (origin.lng + destination.lng) / 2 }, destination],
      },
      {
        name: "A616",
        distanceM: 52000,
        durationS: 3300,
        path: [origin, { lat: (origin.lat + destination.lat) / 2 + 0.05, lng: (origin.lng + destination.lng) / 2 }, destination],
      },
    ]),
};
