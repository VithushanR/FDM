import { useEffect, useState } from "react";
import { ApiError, NETWORK_MESSAGE, type NormalisedError } from "./client";

export interface LoadState<T> {
  data: T | null;
  error: NormalisedError | null;
  loading: boolean;
}

// Loads once per mounted use. Pass a stable loader (a module-level function), not an inline arrow.
export function useLoad<T>(load: () => Promise<T>): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let active = true;
    load()
      .then((data) => {
        if (active) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const normalised: NormalisedError =
          error instanceof ApiError ? error.normalised : { kind: "network", message: NETWORK_MESSAGE };
        setState({ data: null, error: normalised, loading: false });
      });
    return () => {
      active = false;
    };
  }, [load]);
  return state;
}
