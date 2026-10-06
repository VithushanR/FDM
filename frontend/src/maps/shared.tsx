import { useMap } from "@vis.gl/react-google-maps";
import { useEffect, useState } from "react";
import type { HotspotOut } from "../api/hotspotContract";
import type { MapControls } from "./types";

// Design-system colours. Fatal takes precedence over Serious.
export const FATAL_COLOURS = { fill: "#A61E19", fillOpacity: 0.3, stroke: "#A61E19" };
export const SERIOUS_COLOURS = { fill: "#F5B71F", fillOpacity: 0.38, stroke: "#9A5B00" };
export const SELECTED_COLOUR = "#0A3F86";
export const GB_BOUNDS = { north: 60.9, south: 49.8, west: -8.7, east: 1.8 };

// Diameter in screen pixels: clamp(9, 6 + 3.5*sqrt(collisions), 36), scaled by 1.25 at zoom 11 or more.
export function circleRadiusPx(collisions: number, zoom: number): number {
  // Smaller than the first pass: the earlier sizes made dense clusters hard to read.
  const diameter = Math.min(36, Math.max(9, 6 + 3.5 * Math.sqrt(collisions)));
  return (zoom >= 11 ? diameter * 1.25 : diameter) / 2;
}

// Reports the map instance to the page, so it can zoom and pan with its own buttons.
export function MapBridge({ onMap, fitGreatBritain }: { onMap?: (controls: MapControls) => void; fitGreatBritain?: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    if (fitGreatBritain) {
      map.fitBounds(
        { north: GB_BOUNDS.north, south: GB_BOUNDS.south, east: GB_BOUNDS.east, west: GB_BOUNDS.west },
        24,
      );
    }
    onMap?.({
      zoomBy: (delta: number) => {
        map.setZoom((map.getZoom() ?? 6) + delta);
      },
    });
  }, [map, onMap, fitGreatBritain]);
  return null;
}

// The current zoom, kept in state so markers can be redrawn when it changes.
export function useZoom(): number | null {
  const map = useMap();
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => {
    if (!map) return;
    setZoom(map.getZoom() ?? null);
    const listener = map.addListener("zoom_changed", () => {
      setZoom(map.getZoom() ?? null);
    });
    return () => {
      listener.remove();
    };
  }, [map]);
  return zoom;
}

// Circles drawn in screen pixels. The largest are added first, with the lowest z-index, so small ones stay clickable.
export function drawHotspotMarkers(
  map: google.maps.Map,
  hotspots: HotspotOut[],
  zoom: number,
  selectedId: number | null,
  onSelect: (id: number) => void,
  onHover: (id: number | null) => void,
): google.maps.Marker[] {
  const ordered = [...hotspots].sort((a, b) => b.collisions - a.collisions);
  return ordered.map((hotspot, index) => {
    const colours = hotspot.fatal > 0 ? FATAL_COLOURS : SERIOUS_COLOURS;
    const selected = hotspot.id === selectedId;
    const marker = new google.maps.Marker({
      map,
      position: { lat: hotspot.latitude, lng: hotspot.longitude },
      clickable: true,
      zIndex: index,
      title: `${hotspot.collisions} collisions`,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: circleRadiusPx(hotspot.collisions, zoom),
        fillColor: colours.fill,
        fillOpacity: colours.fillOpacity,
        strokeColor: selected ? SELECTED_COLOUR : colours.stroke,
        strokeWeight: selected ? 3 : 2,
      },
    });
    marker.addListener("click", () => {
      onSelect(hotspot.id);
    });
    marker.addListener("mouseover", () => {
      onHover(hotspot.id);
    });
    marker.addListener("mouseout", () => {
      onHover(null);
    });
    return marker;
  });
}
