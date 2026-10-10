import { useEffect, useState } from "react";
import { getHotspotCounts, type HotspotCounts } from "./endpoints";

// The Show counts for one query, or null while they load, when they fail, or when query is null (an older backend).
// Without counts every option stays available, so a failure never blocks the list.
export function useHotspotCounts(query: string | null): HotspotCounts | null {
  const [state, setState] = useState<{ query: string; counts: HotspotCounts } | null>(null);
  useEffect(() => {
    if (query === null) return;
    const controller = new AbortController();
    getHotspotCounts(query, controller.signal)
      .then((counts) => {
        setState({ query, counts });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error("Hotspot counts could not load", error);
      });
    return () => {
      controller.abort();
    };
  }, [query]);
  // Counts for an older query are not shown, so a stale zero never greys out an option.
  return state !== null && state.query === query ? state.counts : null;
}
