import type { Hotspot } from "../api/endpoints";
import { listPath, MONTH_NAMES, type ListQuery, type PersistenceParam } from "../api/hotspotContract";

// Pure functions for the hotspot page: filters, the request, the viewport, the labels and the CSV export.

export type Subset = "severe" | "all";
export type ViewBy = "all" | "time" | "month";
export type SortKey = "collisions" | "fatal" | "share";

export const ALL_TIMES = "All times";
export const LIST_LIMIT = 1000;
// At this zoom or lower only the largest hotspots are drawn, and the map says so.
export const SMALL_ZOOM = 6;
export const SMALL_ZOOM_LIMIT = 400;

export interface HotspotFilters {
  subset: Subset;
  viewBy: ViewBy;
  slice: string;
  month: number | null;
  minCollisions: number;
  persistence: PersistenceParam;
  sort: SortKey;
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export const defaultMinimum = (subset: Subset): number => (subset === "severe" ? 5 : 10);

export function defaultFilters(): HotspotFilters {
  return {
    subset: "severe",
    viewBy: "all",
    slice: ALL_TIMES,
    month: null,
    minCollisions: defaultMinimum("severe"),
    persistence: "any",
    sort: "collisions",
  };
}

// Reads filters from the URL. Anything unknown falls back to the default, so a bad link still opens.
export function filtersFromParams(params: URLSearchParams, slices: string[]): HotspotFilters {
  const subset: Subset = params.get("subset") === "all" ? "all" : "severe";
  const minParam = Number(params.get("min"));
  const minCollisions = Number.isInteger(minParam) && minParam >= 1 ? minParam : defaultMinimum(subset);
  const viewParam = params.get("view");
  const monthParam = Number(params.get("month"));
  const month = Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : null;
  const viewBy: ViewBy = month !== null || viewParam === "month" ? "month" : viewParam === "time" ? "time" : "all";
  const requestedSlice = params.get("slice") ?? ALL_TIMES;
  const timeSlices = slices.filter((slice) => slice !== ALL_TIMES);
  const slice = viewBy === "time" && timeSlices.includes(requestedSlice) ? requestedSlice : ALL_TIMES;
  const persistence = (["persistent", "recent", "fading", "mixed"] as const).find((p) => p === params.get("persistence")) ?? "any";
  const sort = (["fatal", "share"] as const).find((s) => s === params.get("sort")) ?? "collisions";
  return {
    subset,
    viewBy,
    slice: viewBy === "time" ? slice : ALL_TIMES,
    month: viewBy === "month" ? month : null,
    minCollisions,
    persistence,
    sort,
  };
}

export function paramsFromFilters(filters: HotspotFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set("subset", filters.subset);
  if (filters.viewBy === "month") params.set("view", "month");
  if (filters.viewBy === "time") params.set("view", "time");
  if (filters.viewBy === "time") params.set("slice", filters.slice);
  if (filters.month !== null) params.set("month", String(filters.month));
  params.set("min", String(filters.minCollisions));
  if (filters.persistence !== "any") params.set("persistence", filters.persistence);
  if (filters.sort !== "collisions") params.set("sort", filters.sort);
  return params;
}

// The request for the list. The viewport is added by the caller when the backend supports bbox.
export function hotspotQuery(filters: HotspotFilters, bbox: Bounds | null = null): string {
  const query: ListQuery = {
    subset: filters.subset,
    slice: filters.viewBy === "month" ? ALL_TIMES : filters.slice,
    minCollisions: filters.minCollisions,
    limit: LIST_LIMIT,
    month: filters.viewBy === "month" ? filters.month : null,
    persistence: filters.persistence,
    sort: filters.sort,
    bbox: bbox ? [bbox.west, bbox.south, bbox.east, bbox.north] : null,
  };
  return listPath(query);
}

export function inBounds(hotspot: Hotspot, bounds: Bounds): boolean {
  return (
    hotspot.latitude <= bounds.north &&
    hotspot.latitude >= bounds.south &&
    hotspot.longitude <= bounds.east &&
    hotspot.longitude >= bounds.west
  );
}

export function severeShare(hotspot: Hotspot): number {
  return hotspot.collisions === 0 ? 0 : (hotspot.fatal + hotspot.serious) / hotspot.collisions;
}

// The server sorts the list. This matches its order (primary key, then collisions, then id), for the client-side fallback.
export function sortHotspots(list: Hotspot[], sort: SortKey): Hotspot[] {
  const key = (h: Hotspot): number => {
    if (sort === "fatal") return h.fatal;
    if (sort === "share") return severeShare(h);
    return h.collisions;
  };
  return [...list].sort((a, b) => key(b) - key(a) || b.collisions - a.collisions || a.id - b.id);
}

// Label for a hotspot. Some areas (outside England and Wales) have no LSOA, so they get a location instead.
export function hotspotLabel(hotspot: Hotspot): string {
  if (hotspot.label) return `LSOA ${hotspot.label.replace(/^LSOA\s*/, "")}`;
  return `Area near ${hotspot.latitude.toFixed(4)}, ${hotspot.longitude.toFixed(4)}`;
}

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

// Below zoom 6 only the largest hotspots are drawn.
export function drawnHotspots(inView: Hotspot[], zoom: number): Hotspot[] {
  if (zoom > SMALL_ZOOM) return inView;
  return [...inView].sort((a, b) => b.collisions - a.collisions || a.id - b.id).slice(0, SMALL_ZOOM_LIMIT);
}

const CSV_HEADER = [
  "id", "subset", "slice", "month", "latitude", "longitude", "radius_m", "collisions", "fatal", "serious",
  "slight", "label", "years_present", "persistence",
];

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// Every field the API returns, one row per hotspot, in the order given.
export function buildCsv(list: Hotspot[]): string {
  const rows = list.map((h) =>
    [h.id, h.subset, h.slice, h.month ?? null, h.latitude, h.longitude, h.radius_m, h.collisions, h.fatal, h.serious,
      h.slight, h.label ?? null, h.years_present ?? null, h.persistence ?? null]
      .map((cell) => csvCell(cell))
      .join(","),
  );
  return [CSV_HEADER.join(","), ...rows].join("\n") + "\n";
}

export function hotspotsFilename(filters: HotspotFilters): string {
  const slice = filters.viewBy === "month" && filters.month !== null
    ? monthName(filters.month).toLowerCase()
    : filters.slice.toLowerCase().replaceAll(" ", "-");
  return `hotspots-${filters.subset}-${slice}.csv`;
}
