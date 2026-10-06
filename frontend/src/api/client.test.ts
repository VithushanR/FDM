import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NETWORK_MESSAGE, apiRequest, normaliseError } from "./client";
import predictInvalid from "../test/fixtures/predict_invalid.json";
import notFound from "../test/fixtures/not_found.json";
import unavailablePredict from "../test/fixtures/unavailable_predict.json";
import unavailableSchema from "../test/fixtures/unavailable_schema.json";
import unavailableHealth from "../test/fixtures/unavailable_health.json";
import unavailableHotspots from "../test/fixtures/unavailable_hotspots.json";
import unavailableAbout from "../test/fixtures/unavailable_about.json";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normaliseError", () => {
  it("keeps every validation error from the real 422 body", () => {
    const result = normaliseError(predictInvalid.status, predictInvalid.body);
    expect(result.kind).toBe("validation");
    expect(result.errors).toEqual([
      { field: "date", message: "Enter a valid date." },
      { field: "number_of_vehicles", message: "Enter a whole number from 1 to 30." },
    ]);
  });

  it("maps a FastAPI default 422 detail list to field errors, using the last location part", () => {
    // The backend does not produce this shape. It is the FastAPI default, kept as a defensive mapping.
    const body = { detail: [{ loc: ["body", "speed_limit"], msg: "Input should be a valid string" }] };
    expect(normaliseError(422, body)).toEqual({
      kind: "validation",
      message: "Some answers need fixing.",
      errors: [{ field: "speed_limit", message: "Input should be a valid string" }],
    });
  });

  it("returns notfound with the detail message for the real 404 body", () => {
    expect(normaliseError(notFound.status, notFound.body)).toEqual({ kind: "notfound", message: "Not Found" });
  });

  it("reads error for predict and schema 503 bodies", () => {
    const result = normaliseError(unavailablePredict.status, unavailablePredict.body);
    expect(result.kind).toBe("unavailable");
    expect(result.message).toMatch(/^Model file not found at/);
    expect(normaliseError(unavailableSchema.status, unavailableSchema.body).message).toBe(
      unavailableSchema.body.error,
    );
  });

  it("reads error inside status for the health 503 body", () => {
    expect(normaliseError(unavailableHealth.status, unavailableHealth.body)).toEqual({
      kind: "unavailable",
      message: unavailableHealth.body.error,
    });
  });

  it("reads message for the hotspots and about 503 bodies", () => {
    expect(normaliseError(unavailableHotspots.status, unavailableHotspots.body)).toEqual({
      kind: "unavailable",
      message: "Hotspot analysis has not been generated yet.",
    });
    expect(normaliseError(unavailableAbout.status, unavailableAbout.body).message).toContain("sums to 1134");
  });

  it("uses the generic message for a 503 with no message key", () => {
    expect(normaliseError(503, {})).toEqual({ kind: "unavailable", message: "The service is not available." });
  });

  it("returns unknown with the fallback chain for any other error status", () => {
    expect(normaliseError(500, { detail: "Internal problem" })).toEqual({ kind: "unknown", message: "Internal problem" });
    expect(normaliseError(500, null)).toEqual({ kind: "unknown", message: "The service is not available." });
  });
});

describe("apiRequest", () => {
  it("reports a rejected fetch as a network error with the spec message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const error = await apiRequest("/api/health").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).normalised).toEqual({ kind: "network", message: NETWORK_MESSAGE });
  });

  it("reports a body that is not JSON as a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>proxy error</html>", { status: 502 })));
    const error = await apiRequest("/api/schema").catch((caught: unknown) => caught);
    expect((error as ApiError).normalised.kind).toBe("network");
  });

  it("does not hide an abort", async () => {
    const abort = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(apiRequest("/api/predict")).rejects.toBe(abort);
  });
});
