import { AdvancedMarker, Map as GoogleMap, type MapMouseEvent, useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";
import type { HotspotOut } from "../api/hotspotContract";
import type { LatLng, MapCanvasProps, PinStatus } from "./types";
import { drawHotspotMarkers, GB_BOUNDS, MapBridge, useZoom } from "./shared";

const PIN_FILL: Record<PinStatus, string> = {
  covered: "#0A3F86",
  sparse: "#0A3F86",
  unchecked: "#0A3F86",
  outside: "#A61E19",
  none: "#0A3F86",
};

// Map clicks carry their point in event.detail; marker drags carry a Google LatLng on event.latLng.
function clickPoint(event: MapMouseEvent): LatLng | null {
  const point = event.detail.latLng;
  return point ? { lat: point.lat, lng: point.lng } : null;
}

function markerPoint(latLng: google.maps.LatLng | null | undefined): LatLng | null {
  return latLng ? { lat: latLng.lat(), lng: latLng.lng() } : null;
}

// The 500 m ring. Google circles cannot be dashed, so it is drawn solid at low opacity (see docs/backend-gaps.md).
function PinRing({ pin }: { pin: LatLng }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const circle = new google.maps.Circle({
      map,
      center: pin,
      radius: 500,
      strokeColor: "#0A3F86",
      strokeWeight: 2,
      strokeOpacity: 0.7,
      fillColor: "#0A3F86",
      fillOpacity: 0.06,
      clickable: false,
    });
    return () => { circle.setMap(null); };
  }, [map, pin]);
  return null;
}

// Nearby hotspots around the pin, as pixel circles.
function NearbyMarkers({ hotspots }: { hotspots: HotspotOut[] }) {
  const map = useMap();
  const zoom = useZoom();
  useEffect(() => {
    if (!map || zoom === null) return;
    const markers = drawHotspotMarkers(map, hotspots, zoom, null, () => undefined, () => undefined);
    return () => {
      markers.forEach((marker) => { marker.setMap(null); });
    };
  }, [map, hotspots, zoom]);
  return null;
}

export function GoogleMapCanvas({
  center,
  zoom,
  pin,
  pinStatus,
  restrictToGreatBritain,
  hotspots,
  onPick,
  onPinDragEnd,
  onMap,
}: MapCanvasProps) {
  const mapId: string = String(import.meta.env.VITE_GOOGLE_MAP_ID || "DEMO_MAP_ID");
  return (
    <GoogleMap
      defaultCenter={center}
      defaultZoom={zoom}
      mapId={mapId}
      clickableIcons={false}
      disableDefaultUI
      gestureHandling="greedy"
      restriction={restrictToGreatBritain ? { latLngBounds: GB_BOUNDS, strictBounds: false } : undefined}
      onClick={(event) => {
        const point = clickPoint(event);
        if (point) onPick(point);
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <MapBridge onMap={onMap} fitGreatBritain={restrictToGreatBritain} />
      {hotspots.length > 0 ? <NearbyMarkers hotspots={hotspots} /> : null}
      {pin ? (
        <>
          <PinRing pin={pin} />
          <AdvancedMarker
            position={pin}
            draggable
            onDragEnd={(event) => {
              const point = markerPoint(event.latLng);
              if (point) onPinDragEnd(point);
            }}
            title="Location pin"
          >
            <svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true">
              <path
                d="M17 1C8 1 1 8 1 17c0 12 16 26 16 26s16-14 16-26C33 8 26 1 17 1z"
                fill={PIN_FILL[pinStatus]}
                stroke="#fff"
                strokeWidth="3"
              />
            </svg>
          </AdvancedMarker>
        </>
      ) : null}
    </GoogleMap>
  );
}
