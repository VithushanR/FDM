// The hotspot endpoints, as the backend builds them. Response types come from openapi.ts; the names here are
// only the request shapes the frontend builds.
import type { components } from "./openapi";

export type HotspotOut = components["schemas"]["HotspotOut"];
export type HotspotListOut = components["schemas"]["HotspotListOut"];
export type NearbyOut = components["schemas"]["NearbyOut"];
export type NearbyListOut = components["schemas"]["NearbyListOut"];
export type DetailsOut = components["schemas"]["DetailsOut"];
export type AlongRouteOut = components["schemas"]["AlongRouteOut"];
export type RouteHotspotOut = components["schemas"]["RouteHotspotOut"];

export interface HotspotFeatures {
  bbox?: boolean;
  nearby?: boolean;
  details?: boolean;
  route?: boolean;
  months?: boolean;
  persistence?: boolean;
  total_matched?: boolean;
}

export type PersistenceParam = "any" | "persistent" | "recent" | "fading" | "mixed";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface ListQuery {
  subset: "severe" | "all";
  slice: string;
  minCollisions: number;
  limit: number;
  month: number | null;
  persistence: PersistenceParam;
  sort: "collisions" | "fatal" | "share";
  bbox: [number, number, number, number] | null;
}

export function listPath(query: ListQuery): string {
  const params = new URLSearchParams({
    subset: query.subset,
    slice: query.slice,
    min_collisions: String(query.minCollisions),
    limit: String(query.limit),
    sort: query.sort,
  });
  if (query.month !== null) params.set("month", String(query.month));
  if (query.persistence !== "any") params.set("persistence", query.persistence);
  if (query.bbox) params.set("bbox", query.bbox.map((value) => value.toFixed(5)).join(","));
  return `/api/hotspots?${params.toString()}`;
}

export function nearbyPath(latitude: number, longitude: number, radiusM = 500, limit = 10): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(6),
    longitude: longitude.toFixed(6),
    radius_m: String(radiusM),
    subset: "severe",
    slice: "All times",
    limit: String(limit),
  });
  return `/api/hotspots/nearby?${params.toString()}`;
}
