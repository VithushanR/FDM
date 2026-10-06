import { useEffect, useState } from "react";
import { getNearby, type Hotspot } from "./endpoints";
import { nearbyPath, type NearbyOut } from "./hotspotContract";

export interface NearbyState {
  items: NearbyOut[] | null;
  failed: boolean;
}

// Nearby hotspots for the pin: severe, within 500 m of the pin's centre. Off unless the backend reports the feature.
export function useNearby(pin: { lat: number; lng: number } | null, enabled: boolean): NearbyState {
  const [state, setState] = useState<NearbyState>({ items: null, failed: false });
  const lat = pin?.lat ?? null;
  const lng = pin?.lng ?? null;
  useEffect(() => {
    if (!enabled || lat === null || lng === null) {
      setState({ items: null, failed: false });
      return;
    }
    const controller = new AbortController();
    setState({ items: null, failed: false });
    getNearby(nearbyPath(lat, lng), controller.signal)
      .then((body) => {
        setState({ items: body.hotspots, failed: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        void error;
        setState({ items: null, failed: true });
      });
    return () => {
      controller.abort();
    };
  }, [enabled, lat, lng]);
  return state;
}

export type { Hotspot };
