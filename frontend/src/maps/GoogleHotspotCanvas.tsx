import { AdvancedMarker, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";
import type { HotspotCanvasProps, RouteOverlay } from "./types";
import { drawHotspotMarkers, MapBridge, SELECTED_COLOUR, useZoom } from "./shared";

function ViewReporter({ onViewChange }: Pick<HotspotCanvasProps, "onViewChange">) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("idle", () => {
      const bounds = map.getBounds()?.toJSON();
      const center = map.getCenter();
      const zoom = map.getZoom();
      if (!bounds || !center || zoom === undefined) return;
      onViewChange({
        center: { lat: center.lat(), lng: center.lng() },
        zoom,
        bounds: { north: bounds.north, south: bounds.south, east: bounds.east, west: bounds.west },
      });
    });
    return () => {
      listener.remove();
    };
  }, [map, onViewChange]);
  return null;
}

function TargetPan({ target }: Pick<HotspotCanvasProps, "target">) {
  const map = useMap();
  useEffect(() => {
    if (!map || !target) return;
    map.panTo(target.center);
    map.setZoom(target.zoom);
  }, [map, target]);
  return null;
}

function HotspotMarkers({ hotspots, selectedId, onSelect, onHover }: Pick<HotspotCanvasProps, "hotspots" | "selectedId" | "onSelect" | "onHover">) {
  const map = useMap();
  const zoom = useZoom();
  useEffect(() => {
    if (!map || zoom === null) return;
    const markers = drawHotspotMarkers(map, hotspots, zoom, selectedId, onSelect, onHover);
    return () => {
      markers.forEach((marker) => { marker.setMap(null); });
    };
  }, [map, hotspots, zoom, selectedId, onSelect, onHover]);
  return null;
}

// A white casing under the selected route, and grey lines for the others. Only the selected route is blue.
function RouteLines({ routes }: { routes: RouteOverlay[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const lines: google.maps.Polyline[] = [];
    for (const route of routes) {
      const path = route.path.map((point) => ({ lat: point.lat, lng: point.lng }));
      if (route.selected) {
        lines.push(new google.maps.Polyline({ map, path, strokeColor: "#FFFFFF", strokeWeight: 12, strokeOpacity: 1, clickable: false }));
        lines.push(new google.maps.Polyline({ map, path, strokeColor: SELECTED_COLOUR, strokeWeight: 7, strokeOpacity: 1, clickable: false }));
      } else {
        lines.push(new google.maps.Polyline({ map, path, strokeColor: "#7A8794", strokeWeight: 6, strokeOpacity: 0.9, clickable: false }));
      }
    }
    return () => {
      lines.forEach((line) => { line.setMap(null); });
    };
  }, [map, routes]);
  return null;
}

// Lettered start and end markers for each route: 34px blue circles with a white border.
function RouteEnds({ routes }: { routes: RouteOverlay[] }) {
  return (
    <>
      {routes.flatMap((route) =>
        [
          { key: `${route.id}-start`, point: route.start, letter: "A" },
          { key: `${route.id}-end`, point: route.end, letter: "B" },
        ].flatMap((end) =>
          end.point && route.selected ? [
            <AdvancedMarker key={end.key} position={end.point} title={`Route ${route.letter}`}>
              <div style={{ width: 34, height: 34, borderRadius: 17, background: SELECTED_COLOUR, color: "#fff", border: "3px solid #fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                {end.letter}
              </div>
            </AdvancedMarker>,
          ] : [],
        ),
      )}
    </>
  );
}

// Fits the view to the selected route the first time it is shown.
function FitRoutes({ routes, fit }: { routes: RouteOverlay[]; fit: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !fit || routes.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    for (const route of routes) {
      for (const point of route.path) bounds.extend({ lat: point.lat, lng: point.lng });
    }
    map.fitBounds(bounds, 40);
  }, [map, routes, fit]);
  return null;
}

export function GoogleHotspotCanvas(props: HotspotCanvasProps) {
  const mapId: string = String(import.meta.env.VITE_GOOGLE_MAP_ID || "DEMO_MAP_ID");
  return (
    <GoogleMap
      defaultCenter={props.initialCenter}
      defaultZoom={props.initialZoom}
      mapId={mapId}
      clickableIcons={false}
      disableDefaultUI
      gestureHandling="greedy"
      style={{ width: "100%", height: "100%" }}
    >
      <MapBridge onMap={props.onMap} />
      <ViewReporter onViewChange={props.onViewChange} />
      <TargetPan target={props.target} />
      <HotspotMarkers
        hotspots={props.hotspots}
        selectedId={props.selectedId}
        onSelect={props.onSelect}
        onHover={props.onHover}
      />
      <RouteLines routes={props.routes} />
      <FitRoutes routes={props.routes} fit={props.fitRoutes} />
      <RouteEnds routes={props.routes} />
    </GoogleMap>
  );
}
