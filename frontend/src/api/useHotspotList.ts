import { useEffect, useState } from "react";
import { ApiError, NETWORK_MESSAGE } from "./client";
import { getHotspots, type HotspotList } from "./endpoints";

export interface HotspotListState {
  data: HotspotList | null;
  error: string | null;
  loading: boolean;
}

// Loads the hotspot list for one query. A new query aborts the last request, and the old list stays on screen until the new one arrives.
export function useHotspotList(query: string): HotspotListState {
  const [state, setState] = useState<HotspotListState>({ data: null, error: null, loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true, error: null }));
    getHotspots(query, controller.signal)
      .then((list) => {
        setState({ data: list, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof ApiError ? error.normalised.message : NETWORK_MESSAGE;
        setState((previous) => ({ data: previous.data, error: message, loading: false }));
      });
    return () => {
      controller.abort();
    };
  }, [query]);
  return state;
}
