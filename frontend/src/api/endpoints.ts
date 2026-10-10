import type { components } from "./openapi";
import { apiRequest, postJson } from "./client";
import type { AlongRouteOut, DetailsOut, HotspotFeatures, HotspotListOut, HotspotOut, NearbyListOut } from "./hotspotContract";

export type { AlongRouteOut, DetailsOut, HotspotOut, NearbyOut, RouteHotspotOut } from "./hotspotContract";

export type Schema = components["schemas"]["SchemaResponse"];
export type FormField = components["schemas"]["FormField"];
export type FormGroup = components["schemas"]["FormGroup"];
export type PredictResponse = components["schemas"]["PredictResponse"];
export type LocationCheck = components["schemas"]["LocationCheckResponse"];
export type Health = components["schemas"]["HealthOk"];

export interface About {
  model: { name: string; description: string; features: number; trained_on: string; fatal_weight: number };
  data: {
    source: string;
    years: string;
    collisions: number;
    splits: { train: number; validation: number; test: number };
    class_share_percent: Record<string, number>;
    licence: string;
    url: string;
  };
  test_results: {
    split: string;
    macro_f1: number;
    balanced_accuracy: number;
    accuracy: number;
    log_loss: number;
    classes: string[];
    confusion_matrix_rows_true_columns_predicted: number[][];
    per_class: Record<string, { precision: number; recall: number; f1: number; support: number }>;
  };
  limits: string[];
}

export interface HotspotMeta {
  generated_at: string;
  method: string;
  parameters: Record<string, unknown>;
  subsets: string[];
  slices: string[];
  total_hotspots: number;
  months: string[] | null;
  years: number[] | null;
  persistence_labels: string[] | null;
  persistence_rules: Record<string, string> | null;
  features: HotspotFeatures;
  hotspots_per_subset: Record<string, number>;
}

export type Hotspot = HotspotOut;
export type HotspotList = HotspotListOut;
export type HotspotMetaWithFeatures = HotspotMeta;

export const getSchema = (): Promise<Schema> => apiRequest<Schema>("/api/schema");
export const getAbout = (): Promise<About> => apiRequest<About>("/api/about");
export const getHealth = (): Promise<Health> => apiRequest<Health>("/api/health");
export const getHotspotMeta = (): Promise<HotspotMeta> => apiRequest<HotspotMeta>("/api/hotspots/meta");
export const getHotspots = (path: string, signal?: AbortSignal): Promise<HotspotListOut> =>
  apiRequest<HotspotListOut>(path, { signal });
export interface HotspotCounts {
  collisions: number;
  fatal: number;
  severe: number;
}
export const getHotspotCounts = (path: string, signal?: AbortSignal): Promise<HotspotCounts> =>
  apiRequest<HotspotCounts>(path, { signal });
export const getNearby = (path: string, signal?: AbortSignal): Promise<NearbyListOut> =>
  apiRequest<NearbyListOut>(path, { signal });
export const getHotspotDetails = (id: number, signal?: AbortSignal): Promise<DetailsOut> =>
  apiRequest<DetailsOut>(`/api/hotspots/${id}`, { signal });
export const postAlongRoute = (body: Record<string, unknown>, signal?: AbortSignal): Promise<AlongRouteOut> =>
  postJson<AlongRouteOut>("/api/hotspots/along-route", body, signal);
export const postPredict = (body: Record<string, unknown>, signal?: AbortSignal): Promise<PredictResponse> =>
  postJson<PredictResponse>("/api/predict", body, signal);
export const postLocationCheck = (
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<LocationCheck> => postJson<LocationCheck>("/api/location/check", { latitude, longitude }, signal);
