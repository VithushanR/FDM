import type { Hotspot } from "../api/endpoints";
import { listPath, MONTH_NAMES, type ListQuery, type PersistenceParam } from "../api/hotspotContract";

// Pure functions for the hotspot page: filters, the request, the viewport, the labels and the CSV export.

export type Subset = "severe" | "all";
export type ViewBy = "all" | "time" | "month";
export type SortKey = "collisions" | "fatal" | "severe" | "share";
// What the Top in view list and the map show: every hotspot, those with a death, or those with a Fatal or Serious collision.
export type ShowKey = "collisions" | "fatal" | "severe";

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
  show: ShowKey;
}

// How many hotspots in all of Great Britain each Show option has, for the current filters.
export interface ShowCounts {
  collisions: number;
  fatal: number;
  severe: number;
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export const defaultMinimum = (subset: Subset): number => (subset === "severe" ? 5 : 10);

// Fatal and Serious hotspots hold only Fatal and Serious collisions, so "Collisions" would repeat "Has Fatal or Serious" there.
export const defaultShow = (subset: Subset): ShowKey => (subset === "severe" ? "severe" : "collisions");

export const SHOW_LABELS: Record<ShowKey, string> = {
  collisions: "Collisions",
  fatal: "Fatal collisions",
  severe: "Has Fatal or Serious",
};

// The order to fall back in when the chosen option has no hotspots: the widest first.
const SHOW_ORDER: ShowKey[] = ["collisions", "severe", "fatal"];

export interface ShowOption {
  value: ShowKey;
  label: string;
  disabled: boolean;
}

function allowed(subset: Subset, show: ShowKey): boolean {
  return !(subset === "severe" && show === "collisions");
}

// The Show options, with their counts once they are known. An option is greyed out when it does not apply or has none.
export function showOptions(subset: Subset, counts: ShowCounts | null): ShowOption[] {
  return SHOW_ORDER.map((value) => {
    const fits = allowed(subset, value);
    const count = counts && fits ? ` (${counts[value].toLocaleString("en-GB")})` : "";
    return { value, label: `${SHOW_LABELS[value]}${count}`, disabled: !fits || (counts !== null && counts[value] === 0) };
  });
}

// The option actually used. When the chosen one has no hotspots, the widest one that has some is used instead, and
// emptied names the chosen one so the page can say why. The URL keeps the choice, so it comes back with the filters.
export function effectiveShow(filters: HotspotFilters, counts: ShowCounts | null): { show: ShowKey; emptied: ShowKey | null } {
  const chosen = allowed(filters.subset, filters.show) ? filters.show : defaultShow(filters.subset);
  if (counts === null || counts[chosen] > 0) return { show: chosen, emptied: null };
  const next = SHOW_ORDER.find((key) => allowed(filters.subset, key) && counts[key] > 0);
  return next ? { show: next, emptied: chosen } : { show: chosen, emptied: null };
}

export function defaultFilters(): HotspotFilters {
  return {
    subset: "severe",
    viewBy: "all",
    slice: ALL_TIMES,
    month: null,
    minCollisions: defaultMinimum("severe"),
    persistence: "any",
    show: defaultShow("severe"),
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
  const requestedShow = SHOW_ORDER.find((key) => key === params.get("show"));
  const show = requestedShow && allowed(subset, requestedShow) ? requestedShow : defaultShow(subset);
  return {
    subset,
    viewBy,
    slice: viewBy === "time" ? slice : ALL_TIMES,
    month: viewBy === "month" ? month : null,
    minCollisions,
    persistence,
    show,
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
  if (filters.show !== defaultShow(filters.subset)) params.set("show", filters.show);
  return params;
}

// The filters for the counts: everything except Show, for all of Great Britain.
export function countsQuery(filters: HotspotFilters): string {
  const params = new URLSearchParams({
    subset: filters.subset,
    slice: filters.viewBy === "month" ? ALL_TIMES : filters.slice,
    min_collisions: String(filters.minCollisions),
  });
  if (filters.viewBy === "month" && filters.month !== null) params.set("month", String(filters.month));
  if (filters.persistence !== "any") params.set("persistence", filters.persistence);
  return `/api/hotspots/counts?${params.toString()}`;
}

// The request for the list. Show picks what the hotspots must contain, and orders them by that count.
// The viewport is added by the caller when the backend supports bbox.
export function hotspotQuery(filters: HotspotFilters, show: ShowKey, bbox: Bounds | null = null): string {
  const query: ListQuery = {
    subset: filters.subset,
    contains: show === "collisions" ? "any" : show,
    slice: filters.viewBy === "month" ? ALL_TIMES : filters.slice,
    minCollisions: filters.minCollisions,
    limit: LIST_LIMIT,
    month: filters.viewBy === "month" ? filters.month : null,
    persistence: filters.persistence,
    sort: show,
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
    if (sort === "severe") return h.fatal + h.serious;
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
// The time the filters look at, in words, for notes such as "No hotspots with a fatal collision in January".
export function viewText(filters: HotspotFilters): string {
  if (filters.viewBy === "month" && filters.month !== null) return monthName(filters.month);
  if (filters.viewBy === "time") return filters.slice;
  return "all times";
}

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
  return `hotspots-${filters.subset}-${filters.show}-${slice}.csv`;
}
