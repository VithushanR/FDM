// The only place that knows the backend's error shapes. Every request goes through apiRequest.

export type ApiErrorKind = "validation" | "notfound" | "unavailable" | "network" | "unknown";

export interface FieldError {
  field: string;
  message: string;
}

export interface NormalisedError {
  kind: ApiErrorKind;
  message: string;
  errors?: FieldError[];
}

export const NETWORK_MESSAGE =
  "The estimate service is not responding. Check that the backend is running, then try again.";
const FALLBACK_MESSAGE = "The service is not available.";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// message, then error, then detail, as the 503 bodies use different keys.
function messageFrom(body: unknown, fallback: string): string {
  if (!isObject(body)) return fallback;
  return text(body.message) ?? text(body.error) ?? text(body.detail) ?? fallback;
}

// FastAPI's default 422 body: detail is a list of {loc, msg, ...} or, rarely, a string.
function fastApiErrors(detail: unknown): FieldError[] | string {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return FALLBACK_MESSAGE;
  const errors: FieldError[] = [];
  for (const item of detail) {
    if (!isObject(item)) continue;
    const loc = Array.isArray(item.loc) ? item.loc : [];
    const last = loc.length > 0 ? String(loc[loc.length - 1]) : "request";
    errors.push({ field: last, message: text(item.msg) ?? "Enter a valid value." });
  }
  return errors.length > 0 ? errors : FALLBACK_MESSAGE;
}

export function normaliseError(status: number, body: unknown): NormalisedError {
  if (status === 422) {
    if (isObject(body) && Array.isArray(body.errors)) {
      const errors = body.errors.filter(
        (item): item is FieldError => isObject(item) && typeof item.field === "string" && typeof item.message === "string",
      );
      return { kind: "validation", message: "Some answers need fixing.", errors };
    }
    if (isObject(body) && body.detail !== undefined) {
      const detail = fastApiErrors(body.detail);
      if (typeof detail === "string") return { kind: "validation", message: detail, errors: [] };
      return { kind: "validation", message: "Some answers need fixing.", errors: detail };
    }
    return { kind: "unknown", message: FALLBACK_MESSAGE };
  }
  if (status === 404) {
    return { kind: "notfound", message: messageFrom(body, "Not found.") };
  }
  if (status === 503) {
    return { kind: "unavailable", message: messageFrom(body, FALLBACK_MESSAGE) };
  }
  return { kind: "unknown", message: messageFrom(body, FALLBACK_MESSAGE) };
}

export class ApiError extends Error {
  readonly normalised: NormalisedError;

  constructor(normalised: NormalisedError) {
    super(normalised.message);
    this.name = "ApiError";
    this.normalised = normalised;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError({ kind: "network", message: NETWORK_MESSAGE });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError({ kind: "network", message: NETWORK_MESSAGE });
  }
  if (!response.ok) {
    throw new ApiError(normaliseError(response.status, body));
  }
  return body as T;
}

export function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}
