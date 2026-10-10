import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getHotspotMeta, type Hotspot } from "../api/endpoints";
import type { RouteHotspotOut } from "../api/hotspotContract";
import { useHotspotList } from "../api/useHotspotList";
import { useLoad } from "../api/useLoad";
import { DetailsCard } from "../components/DetailsCard";
import { Frame } from "../components/Frame";
import { HotspotFilters } from "../components/HotspotFilters";
import { HotspotList } from "../components/HotspotList";
import { HotspotMap, INITIAL_CENTER, INITIAL_ZOOM } from "../components/HotspotMap";
import { RouteCheck } from "../components/RouteCheck";
import { Segmented } from "../components/Segmented";
import { StatusBox } from "../components/StatusBox";
import styles from "../components/hotspots.module.css";
import ui from "../components/ui.module.css";
import type { LatLng, MapTarget, RouteOverlay, ViewState } from "../maps/types";
import {
  buildCsv,
  defaultFilters,
  drawnHotspots,
  filtersFromParams,
  hotspotQuery,
  hotspotsFilename,
  inBounds,
  paramsFromFilters,
  SMALL_ZOOM,
  type HotspotFilters as Filters,
  type SortKey,
} from "../state/hotspotState";

const PAGE_SIZE = 6;
const SHOW_MORE = 10;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;
const PLACE_ZOOM = 15;
// Selecting a hotspot zooms to at least this level, close enough to see the streets.
const SELECT_ZOOM = 14;
const VIEW_DEBOUNCE_MS = 300;

function parseId(text: string | null): number | null {
  const value = Number(text);
  return text !== null && Number.isInteger(value) && value > 0 ? value : null;
}

function readView(params: URLSearchParams): { center: LatLng; zoom: number } {
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const zoom = Number(params.get("z"));
  const hasCentre = params.has("lat") && params.has("lng") && Number.isFinite(lat) && Number.isFinite(lng);
  return {
    center: hasCentre ? { lat, lng } : INITIAL_CENTER,
    zoom: Number.isInteger(zoom) && zoom >= MIN_ZOOM && zoom <= MAX_ZOOM ? zoom : INITIAL_ZOOM,
  };
}

// The value, delayed until it has stopped changing for the given time.
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delay]);
  return debounced;
}

export function HotspotsPage() {
  const [params, setParams] = useSearchParams();
  const meta = useLoad(getHotspotMeta);
  const slices = useMemo(() => meta.data?.slices ?? [], [meta.data]);
  const features = useMemo(() => meta.data?.features ?? {}, [meta.data]);
  const bboxOn = features.bbox === true;
  const detailsOn = features.details === true;
  const routeOn = features.route === true;

  const filters = useMemo(() => filtersFromParams(params, slices), [params, slices]);
  const selectedId = parseId(params.get("id"));

  const [initial] = useState(() => readView(params));
  const [view, setView] = useState<ViewState | null>(null);
  const debouncedView = useDebounced(view, VIEW_DEBOUNCE_MS);
  const query = hotspotQuery(filters, bboxOn ? (debouncedView?.bounds ?? null) : null);
  const list = useHotspotList(query);
  const body = list.data;
  const listHotspots = useMemo<Hotspot[]>(() => body?.hotspots ?? [], [body]);
  const totalMatched = body?.total_matched ?? listHotspots.length;
  const truncated = body?.truncated === true;

  const [target, setTarget] = useState<MapTarget | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [tab, setTab] = useState<"top" | "route">("top");
  const [routeOverlays, setRouteOverlays] = useState<RouteOverlay[]>([]);
  const [routeHotspots, setRouteHotspots] = useState<RouteHotspotOut[] | null>(null);
  const targetKey = useRef(0);

  // The router's setter changes identity when the URL changes. Callbacks read it through a ref, so they stay stable.
  const navigateRef = useRef(setParams);
  useEffect(() => {
    navigateRef.current = setParams;
  });

  // With bbox the server has already filtered to the view. Without it, the list is filtered in the browser.
  const inView = useMemo(
    () => (bboxOn || !view ? listHotspots : listHotspots.filter((hotspot) => inBounds(hotspot, view.bounds))),
    [bboxOn, listHotspots, view],
  );
  const zoom = view?.zoom ?? initial.zoom;
  const drawn = useMemo(() => drawnHotspots(inView, zoom), [inView, zoom]);
  const mapHotspots = routeHotspots !== null ? (routeHotspots as Hotspot[]) : drawn;
  const listItems = inView.slice(0, shown);
  // A hotspot picked from the route table may not be in the list, so the drawn hotspots are checked too.
  const selected =
    listHotspots.find((hotspot) => hotspot.id === selectedId) ??
    mapHotspots.find((hotspot) => hotspot.id === selectedId) ??
    null;
  const hovered = listHotspots.find((hotspot) => hotspot.id === hoveredId) ?? null;
  const smallZoomNote = routeHotspots === null && zoom <= SMALL_ZOOM && drawn.length < inView.length;

  const onViewChange = useCallback((next: ViewState) => {
    setView(next);
    navigateRef.current(
      (previous) => {
        const updated = new URLSearchParams(previous);
        updated.set("lat", next.center.lat.toFixed(4));
        updated.set("lng", next.center.lng.toFixed(4));
        updated.set("z", String(next.zoom));
        return updated;
      },
      { replace: true },
    );
  }, []);

  // The view from before a selection zoomed the map in, so the back button can return to it.
  const [returnView, setReturnView] = useState<{ center: LatLng; zoom: number } | null>(null);

  // The drawn hotspots and the view, read through a ref so onSelect stays stable and the markers are not redrawn.
  const latest = useRef({ mapHotspots, zoom, center: view?.center ?? initial.center });
  useEffect(() => {
    latest.current = { mapHotspots, zoom, center: view?.center ?? initial.center };
  });

  // Selects a hotspot, from the list or the map, and flies the map to it.
  const onSelect = useCallback((id: number) => {
    navigateRef.current((previous) => {
      const updated = new URLSearchParams(previous);
      updated.set("id", String(id));
      return updated;
    });
    const hotspot = latest.current.mapHotspots.find((item) => item.id === id);
    if (hotspot) {
      // Keep the first view only, so selecting several hotspots in a row still goes back to the wide view.
      const { center, zoom: current } = latest.current;
      setReturnView((previous) => previous ?? { center, zoom: current });
      targetKey.current += 1;
      setTarget({
        center: { lat: hotspot.latitude, lng: hotspot.longitude },
        zoom: Math.max(latest.current.zoom, SELECT_ZOOM),
        key: targetKey.current,
      });
    }
  }, []);

  // Clears the selection. The map stays where it is.
  const onClearSelection = useCallback(() => {
    navigateRef.current((previous) => {
      if (!previous.has("id")) return previous;
      const updated = new URLSearchParams(previous);
      updated.delete("id");
      return updated;
    });
  }, []);

  // Clears the selection and returns the map to the view from before the selection.
  const onBack = useCallback(() => {
    if (!returnView) return;
    onClearSelection();
    targetKey.current += 1;
    setTarget({ ...returnView, key: targetKey.current });
    setReturnView(null);
  }, [returnView, onClearSelection]);

  const onHover = useCallback((id: number | null) => {
    setHoveredId(id);
  }, []);

  const onZoom = useCallback(
    (delta: number) => {
      targetKey.current += 1;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta));
      setTarget({ center: view?.center ?? initial.center, zoom: next, key: targetKey.current });
    },
    [view, initial, zoom],
  );

  const onPlace = useCallback((point: LatLng) => {
    targetKey.current += 1;
    setTarget({ center: point, zoom: PLACE_ZOOM, key: targetKey.current });
  }, []);

  function changeFilters(patch: Partial<Filters>, keepSelection = true) {
    const next = { ...filters, ...patch };
    navigateRef.current((previous) => {
      const updated = paramsFromFilters(next);
      for (const key of keepSelection ? ["id", "lat", "lng", "z"] : ["lat", "lng", "z"]) {
        const value = previous.get(key);
        if (value !== null) updated.set(key, value);
      }
      return updated;
    });
    setShown(PAGE_SIZE);
  }

  // A new ranking clears the selection and returns the map to the wider view, so the new top hotspots are visible.
  // Done in one URL update, because two updates in a row would overwrite each other.
  function changeSort(sort: SortKey) {
    changeFilters({ sort }, false);
    if (returnView) {
      targetKey.current += 1;
      setTarget({ ...returnView, key: targetKey.current });
      setReturnView(null);
    }
  }

  function reset() {
    navigateRef.current(paramsFromFilters(defaultFilters()));
    setShown(PAGE_SIZE);
  }

  function changeTab(next: "top" | "route") {
    setTab(next);
    if (next === "top") {
      setRouteOverlays([]);
      setRouteHotspots(null);
    }
  }

  function exportCsv() {
    const blob = new Blob([buildCsv(inView)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = hotspotsFilename(filters);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // After a selection, move focus to the details heading so keyboard and screen reader users land on it.
  // It does not scroll, so the map stays in view while it flies to the hotspot.
  const hasSelection = selected !== null;
  useEffect(() => {
    if (hasSelection) document.getElementById("details-heading")?.focus({ preventScroll: true });
  }, [selectedId, hasSelection]);

  // Escape clears the selection, unless it is closing something in a text box or menu first.
  useEffect(() => {
    if (selectedId === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      onClearSelection();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedId, onClearSelection]);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 id="page-heading" tabIndex={-1}>
            Hotspots
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 16 }}>
            Where Fatal and Serious collisions cluster, 2021 to 2025. A hotspot is a past concentration, not a prediction.
          </p>
        </div>
        <div className={ui.muted}>Data: DfT STATS19, Great Britain</div>
      </div>

      <HotspotFilters
        filters={filters}
        slices={slices}
        features={features}
        rules={meta.data?.persistence_rules ?? null}
        onChange={changeFilters}
        onReset={reset}
      />

      {meta.error ? (
        <StatusBox tone="warn">Some filter options could not load. The list still works with the defaults.</StatusBox>
      ) : null}
      {truncated ? (
        <StatusBox tone="warn">
          Showing the {listHotspots.length.toLocaleString("en-GB")} largest of {totalMatched.toLocaleString("en-GB")} hotspots. Raise the
          minimum collisions or zoom in to see the rest.
        </StatusBox>
      ) : null}

      <div className={styles.workbench}>
        <Frame className={styles.fillFrame}>
          <div className={styles.fillInner}>
            <HotspotMap
              hotspots={mapHotspots}
              selectedId={selectedId}
              hovered={hovered}
              target={target}
              routes={routeOverlays}
              fitRoutes={routeOverlays.length > 0}
              initialCenter={initial.center}
              initialZoom={initial.zoom}
              loading={list.loading}
              error={list.error}
              smallZoomNote={smallZoomNote}
              onViewChange={onViewChange}
              onSelect={onSelect}
              onClearSelection={onClearSelection}
              onBack={returnView ? onBack : null}
              onHover={onHover}
              onZoom={onZoom}
              onPlace={onPlace}
            />
          </div>
        </Frame>

        <Frame className={styles.fillFrame}>
          <div className={styles.sidePanel} style={{ padding: "22px 24px" }}>
            <div className={styles.stickyHead}>
              <Segmented<"top" | "route">
                label="Side panel"
                value={tab}
                options={[
                  { value: "top", label: "Top in view" },
                  {
                    value: "route",
                    label: "Route check",
                    disabled: !routeOn,
                    title: routeOn ? undefined : "Not available: the route endpoint is not built yet.",
                  },
                ]}
                onChange={changeTab}
              />
            </div>
            <div className={styles.panelBody}>
              {tab === "top" ? (
                <HotspotList
                  items={listItems}
                  inView={inView.length}
                  total={totalMatched}
                  selectedId={selectedId}
                  sort={filters.sort}
                  onSort={changeSort}
                  onSelect={onSelect}
                  onShowMore={() => {
                    setShown((count) => count + SHOW_MORE);
                  }}
                  onExport={exportCsv}
                  canExport={inView.length > 0}
                />
              ) : (
                <RouteCheck
                  filters={filters}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  onOverlay={(overlays, hotspots) => {
                    setRouteOverlays(overlays);
                    setRouteHotspots(hotspots);
                  }}
                />
              )}
            </div>
          </div>
        </Frame>
      </div>

      <DetailsCard hotspot={selected} detailsOn={detailsOn} rules={meta.data?.persistence_rules ?? null} />
    </div>
  );
}
