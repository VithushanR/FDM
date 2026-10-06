import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import about from "./fixtures/about.json";
import alongRoute from "./fixtures/along_route_manchester_sheffield.json";
import details from "./fixtures/hotspot_details_top.json";
import hotspotsAll from "./fixtures/hotspots_all_all_times.json";
import hotspotsMeta from "./fixtures/hotspots_meta.json";
import hotspotsMonthJuly from "./fixtures/hotspots_month_july.json";
import hotspotsRecent from "./fixtures/hotspots_recent.json";
import hotspotsSevere from "./fixtures/hotspots_severe_all_times.json";
import locationBelfast from "./fixtures/location_belfast.json";
import locationLondon from "./fixtures/location_london.json";
import nearbyLondon from "./fixtures/nearby_london_pin.json";
import nearbyTop from "./fixtures/nearby_top.json";
import predictStandard from "./fixtures/predict_standard.json";
import schema from "./fixtures/schema.json";

type Row = (typeof hotspotsSevere.body.hotspots)[number];

// The list endpoint, answered from the captured lists. Month and persistence use their own captures, and
// everything else is filtered and sorted the way the backend does it.
function listResponse(url: URL) {
  const subset = url.searchParams.get("subset") ?? "all";
  const minimum = Number(url.searchParams.get("min_collisions") ?? "1");
  const limit = Number(url.searchParams.get("limit") ?? "200");
  const sort = url.searchParams.get("sort") ?? "collisions";
  const month = url.searchParams.get("month");
  const persistence = url.searchParams.get("persistence");
  let base: Row[];
  if (month !== null) {
    base = month === "7" ? (hotspotsMonthJuly.body.hotspots as unknown as Row[]) : [];
  } else if (persistence === "recent") {
    base = hotspotsRecent.body.hotspots as unknown as Row[];
  } else {
    base = (subset === "severe" ? hotspotsSevere.body.hotspots : hotspotsAll.body.hotspots) as unknown as Row[];
  }
  const filtered = base.filter((row) => row.collisions >= minimum);
  const key = (row: Row) => (sort === "fatal" ? row.fatal : sort === "share" ? (row.fatal + row.serious) / row.collisions : row.collisions);
  const sorted = [...filtered].sort((a, b) => key(b) - key(a) || b.collisions - a.collisions || a.id - b.id);
  const chosen = sorted.slice(0, limit);
  return {
    count: chosen.length,
    subset,
    slice: url.searchParams.get("slice") ?? "All times",
    total_matched: filtered.length,
    truncated: filtered.length > chosen.length,
    hotspots: chosen,
  };
}

// Default handlers return the bodies captured from the live backend. Tests override them with server.use().
export const handlers = [
  http.get("/api/schema", () => HttpResponse.json(schema.body, { status: schema.status })),
  http.get("/api/about", () => HttpResponse.json(about.body, { status: about.status })),
  http.get("/api/hotspots/meta", () => HttpResponse.json(hotspotsMeta.body, { status: hotspotsMeta.status })),
  http.post("/api/predict", () => HttpResponse.json(predictStandard.body, { status: predictStandard.status })),
  http.post("/api/location/check", async ({ request }) => {
    const body = (await request.json()) as { latitude: number; longitude: number };
    // Belfast is the outside point, Central London is covered. Anything else is treated as London.
    const fixture = body.latitude < 54.5 ? locationLondon : locationBelfast;
    return HttpResponse.json(fixture.body, { status: fixture.status });
  }),
  http.get("/api/hotspots", ({ request }) => HttpResponse.json(listResponse(new URL(request.url)))),
  http.get("/api/hotspots/nearby", ({ request }) => {
    const latitude = Number(new URL(request.url).searchParams.get("latitude"));
    const fixture = latitude > 51.4 && latitude < 51.6 ? nearbyLondon : nearbyTop;
    return HttpResponse.json(fixture.body, { status: fixture.status });
  }),
  http.get("/api/hotspots/:id", () => HttpResponse.json(details.body, { status: details.status })),
  http.post("/api/hotspots/along-route", () => HttpResponse.json(alongRoute.body, { status: alongRoute.status })),
];

export const server = setupServer(...handlers);
