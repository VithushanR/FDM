import { useState } from "react";
import { postAlongRoute, type AlongRouteOut, type RouteHotspotOut } from "../api/endpoints";
import { useMaps } from "../maps/MapsContext";
import type { LatLng, RouteAlternative, RouteOverlay } from "../maps/types";
import { hotspotLabel, type HotspotFilters } from "../state/hotspotState";
import { PlaceSearchBox } from "./PlaceSearchBox";
import { Pill } from "./Pill";
import { Segmented } from "./Segmented";
import { StatusBox } from "./StatusBox";
import styles from "./hotspots.module.css";
import ui from "./ui.module.css";

const NOTE =
  "These are hotspots along the route, not a safety ranking. Traffic volume is not in the data, and hotspots show past collisions only. Counts follow the filters above.";
const ROUTE_POINT_CAP = 500;
const ERROR_MESSAGE = "Could not get a route. Check the places and try again.";

interface Checked {
  id: string;
  letter: string;
  alternative: RouteAlternative;
  along: AlongRouteOut;
}

// Thins a route to at most 500 points, keeping the first and last.
export function thinPath(path: LatLng[], cap = ROUTE_POINT_CAP): LatLng[] {
  if (path.length <= cap) return path;
  const step = Math.ceil(path.length / cap);
  const thinned = path.filter((_, index) => index % step === 0);
  const last = path[path.length - 1];
  if (last && thinned[thinned.length - 1] !== last) thinned.push(last);
  return thinned;
}

function minutes(seconds: number): string {
  const total = Math.round(seconds / 60);
  return `${Math.floor(total / 60)} h ${total % 60} min`;
}

export function RouteCheck({
  filters,
  onOverlay,
}: {
  filters: HotspotFilters;
  onOverlay: (routes: RouteOverlay[], hotspots: RouteHotspotOut[] | null) => void;
}) {
  const maps = useMaps();
  const [from, setFrom] = useState<{ point: LatLng; name: string } | null>(null);
  const [to, setTo] = useState<{ point: LatLng; name: string } | null>(null);
  const [buffer, setBuffer] = useState<100 | 200 | 300>(200);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(false);
  const [routes, setRoutes] = useState<Checked[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  function publish(next: Checked[], chosen: string | null) {
    const overlays: RouteOverlay[] = next.map((route) => ({
      id: route.id,
      letter: route.letter,
      path: route.alternative.path,
      selected: route.id === chosen,
      start: route.id === chosen ? route.alternative.path[0] ?? null : null,
      end: route.id === chosen ? route.alternative.path[route.alternative.path.length - 1] ?? null : null,
    }));
    const chosenRoute = next.find((route) => route.id === chosen);
    onOverlay(overlays, chosenRoute ? chosenRoute.along.hotspots : null);
  }

  async function check() {
    if (!from || !to || !maps.routes) return;
    setChecking(true);
    setError(false);
    try {
      const alternatives = await maps.routes.alternatives(from.point, to.point);
      const checked = await Promise.all(
        alternatives.slice(0, 3).map(async (alternative, index): Promise<Checked> => {
          const path = thinPath(alternative.path).map((point) => [point.lat, point.lng]);
          const along = await postAlongRoute({
            path,
            buffer_m: buffer,
            subset: filters.subset,
            slice: filters.viewBy === "month" ? "All times" : filters.slice,
            month: filters.viewBy === "month" ? filters.month : null,
            min_collisions: filters.minCollisions,
            persistence: filters.persistence,
          });
          const letter = String.fromCharCode(65 + index);
          return { id: letter, letter, alternative, along };
        }),
      );
      setRoutes(checked);
      setSelected(checked[0]?.id ?? null);
      publish(checked, checked[0]?.id ?? null);
    } catch {
      setError(true);
      setRoutes([]);
      onOverlay([], null);
    } finally {
      setChecking(false);
    }
  }

  const current = routes.find((route) => route.id === selected) ?? null;
  return (
    <section aria-labelledby="route-heading" style={{ display: "grid", gap: 12 }}>
      <h3 id="route-heading" className={ui.cardTitle} style={{ fontSize: 24 }}>Route check</h3>
      {maps.placeSearch ? (
        <>
          <PlaceSearchBox label="From" search={maps.placeSearch} onPick={(point, name) => { setFrom({ point, name }); }} />
          <PlaceSearchBox label="To" search={maps.placeSearch} onPick={(point, name) => { setTo({ point, name }); }} />
        </>
      ) : (
        <StatusBox tone="warn">Place search is not available, so a route cannot be checked.</StatusBox>
      )}
      <Segmented<"100" | "200" | "300">
        label="Within this distance of the route"
        value={String(buffer) as "100" | "200" | "300"}
        options={[
          { value: "100", label: "100 m" },
          { value: "200", label: "200 m" },
          { value: "300", label: "300 m" },
        ]}
        onChange={(value) => { setBuffer(Number(value) as 100 | 200 | 300); }}
      />
      <button
        type="button"
        className={ui.btnPrimary}
        style={{ height: 48 }}
        disabled={!from || !to || checking || !maps.routes}
        onClick={() => { void check(); }}
      >
        {checking ? "Checking route..." : "Check route"}
      </button>

      {error ? <StatusBox tone="error" title="Route check failed">{ERROR_MESSAGE}</StatusBox> : null}

      {routes.length > 0 ? (
        <>
          <div style={{ display: "grid", gap: 8 }}>
            {routes.map((route) => (
              <button
                key={route.id}
                type="button"
                aria-pressed={route.id === selected}
                onClick={() => {
                  setSelected(route.id);
                  publish(routes, route.id);
                }}
                className={`${styles.row} ${route.id === selected ? styles.rowSelected : ""}`}
              >
                <span className={styles.rank} aria-hidden="true">{route.letter}</span>
                <span style={{ display: "grid", gap: 2 }}>
                  <span style={{ fontWeight: 700 }}>{route.alternative.name || `Route ${route.letter}`}</span>
                  <span style={{ fontSize: 14 }}>
                    {(route.alternative.distanceM / 1000).toFixed(1)} km, {minutes(route.alternative.durationS)}
                  </span>
                  <span style={{ fontSize: 14 }}>
                    {route.along.summary.hotspots} hotspots, {route.along.summary.collisions} collisions in them,{" "}
                    {route.along.summary.per_10_km ?? "0"} per 10 km
                  </span>
                </span>
              </button>
            ))}
          </div>

          {current ? (
            <section aria-labelledby="along-heading">
              <h4 id="along-heading" className={ui.cardTitle} style={{ fontSize: 20 }}>
                Hotspots along route {current.letter}
              </h4>
              {current.along.hotspots.length === 0 ? (
                <p className={ui.muted} style={{ margin: 0 }}>No hotspots lie within {buffer} m of this route.</p>
              ) : (
                <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                  {current.along.hotspots.map((item) => (
                    <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 14 }}>
                      <span>{item.km_from_start.toFixed(1)} km</span>
                      <span>{hotspotLabel(item)}</span>
                      <span>{item.collisions} collisions</span>
                      <Pill label={item.persistence} />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}
        </>
      ) : null}

      <p className={ui.muted} style={{ fontSize: 13, margin: 0 }}>{NOTE}</p>
    </section>
  );
}
