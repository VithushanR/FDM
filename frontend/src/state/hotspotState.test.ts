import { describe, expect, it } from "vitest";
import type { Hotspot } from "../api/endpoints";
import {
  LIST_LIMIT,
  buildCsv,
  countsQuery,
  defaultFilters,
  drawnHotspots,
  effectiveShow,
  filtersFromParams,
  hotspotQuery,
  hotspotsFilename,
  inBounds,
  paramsFromFilters,
  showOptions,
  sortHotspots,
} from "./hotspotState";

const sample = (overrides: Partial<Hotspot>): Hotspot => ({
  id: 1,
  subset: "severe",
  slice: "All times",
  latitude: 51.5,
  longitude: -0.12,
  radius_m: 200,
  collisions: 10,
  fatal: 1,
  serious: 4,
  slight: 5,
  label: "E01000001",
  ...overrides,
});

describe("filters and the request", () => {
  it("defaults to Fatal and Serious with a minimum of 5", () => {
    expect(defaultFilters()).toMatchObject({ subset: "severe", minCollisions: 5, slice: "All times" });
  });

  it("builds the request from the subset, slice and minimum, with the limit", () => {
    const query = hotspotQuery({ ...defaultFilters(), subset: "all", minCollisions: 10, viewBy: "time", slice: "Night" }, "collisions");
    const url = new URL(query, "http://test");
    expect(url.pathname).toBe("/api/hotspots");
    expect(url.searchParams.get("subset")).toBe("all");
    expect(url.searchParams.get("slice")).toBe("Night");
    expect(url.searchParams.get("min_collisions")).toBe("10");
    expect(url.searchParams.get("limit")).toBe(String(LIST_LIMIT));
    expect(url.searchParams.has("contains")).toBe(false);
  });

  it("asks for what the Show option needs, ordered by that count", () => {
    const fatal = new URL(hotspotQuery(defaultFilters(), "fatal"), "http://test").searchParams;
    expect(fatal.get("contains")).toBe("fatal");
    expect(fatal.get("sort")).toBe("fatal");
    const severe = new URL(hotspotQuery(defaultFilters(), "severe"), "http://test").searchParams;
    expect(severe.get("contains")).toBe("severe");
    expect(severe.get("sort")).toBe("severe");
  });

  it("asks for the counts with every filter except Show and the view", () => {
    const url = new URL(countsQuery({ ...defaultFilters(), viewBy: "month", month: 1, persistence: "recent" }), "http://test");
    expect(url.pathname).toBe("/api/hotspots/counts");
    expect(url.searchParams.get("month")).toBe("1");
    expect(url.searchParams.get("persistence")).toBe("recent");
    expect(url.searchParams.has("bbox")).toBe(false);
  });

  it("reads filters from the URL and falls back to the defaults for anything unknown", () => {
    const slices = ["All times", "Night", "Evening Rush"];
    const parsed = filtersFromParams(new URLSearchParams("subset=bogus&min=0&view=time&slice=Nope"), slices);
    expect(parsed.subset).toBe("severe");
    expect(parsed.minCollisions).toBe(5);
    expect(parsed.viewBy).toBe("time");
    expect(parsed.slice).toBe("All times");
    expect(filtersFromParams(new URLSearchParams("view=time&slice=Night"), slices).slice).toBe("Night");
    expect(filtersFromParams(new URLSearchParams("subset=all"), slices).minCollisions).toBe(10);
  });

  it("writes only the non-default filters to the URL and reads them back", () => {
    const filters = { ...defaultFilters(), subset: "all" as const, minCollisions: 12, show: "fatal" as const };
    const params = paramsFromFilters(filters);
    expect(params.get("subset")).toBe("all");
    expect(params.get("min")).toBe("12");
    expect(params.get("show")).toBe("fatal");
    expect(params.has("persistence")).toBe(false);
    expect(filtersFromParams(params, ["All times"])).toMatchObject({ subset: "all", minCollisions: 12, show: "fatal" });
    expect(paramsFromFilters(defaultFilters()).has("show")).toBe(false);
  });

  it("names the CSV file from the subset and slice", () => {
    expect(hotspotsFilename({ ...defaultFilters(), slice: "Evening Rush" })).toBe("hotspots-severe-severe-evening-rush.csv");
  });
});

describe("the Show options", () => {
  const counts = { collisions: 967, fatal: 154, severe: 967 };

  it("greys out Collisions for Fatal and Serious, where it would repeat Has Fatal or Serious", () => {
    const options = showOptions("severe", counts);
    expect(options.find((o) => o.value === "collisions")).toMatchObject({ disabled: true, label: "Collisions" });
    expect(options.find((o) => o.value === "fatal")).toMatchObject({ disabled: false, label: "Fatal collisions (154)" });
    expect(showOptions("all", counts).every((o) => !o.disabled)).toBe(true);
    // A link asking for Collisions with Fatal and Serious opens on Has Fatal or Serious.
    expect(filtersFromParams(new URLSearchParams("subset=severe&show=collisions"), ["All times"]).show).toBe("severe");
  });

  it("greys out an option with no hotspots, and moves to the widest one that has some", () => {
    const none = { collisions: 40, fatal: 0, severe: 25 };
    expect(showOptions("all", none).find((o) => o.value === "fatal")?.disabled).toBe(true);
    expect(effectiveShow({ ...defaultFilters(), subset: "all", show: "fatal" }, none)).toEqual({ show: "collisions", emptied: "fatal" });
    expect(effectiveShow({ ...defaultFilters(), show: "fatal" }, none)).toEqual({ show: "severe", emptied: "fatal" });
    expect(effectiveShow({ ...defaultFilters(), show: "fatal" }, counts)).toEqual({ show: "fatal", emptied: null });
    // Before the counts arrive every option is open, so nothing is blocked while they load.
    expect(effectiveShow({ ...defaultFilters(), show: "fatal" }, null)).toEqual({ show: "fatal", emptied: null });
    expect(showOptions("all", null).every((o) => !o.disabled)).toBe(true);
  });
});

describe("viewport, sorting and zoom", () => {
  it("keeps a hotspot inside the bounds, including on the edges", () => {
    const bounds = { north: 52, south: 51, east: 0, west: -1 };
    expect(inBounds(sample({ latitude: 51.5, longitude: -0.5 }), bounds)).toBe(true);
    expect(inBounds(sample({ latitude: 52, longitude: 0 }), bounds)).toBe(true);
    expect(inBounds(sample({ latitude: 52.1, longitude: -0.5 }), bounds)).toBe(false);
  });

  it("sorts by collisions, fatal count, or the Fatal and Serious share", () => {
    const list = [
      sample({ id: 1, collisions: 10, fatal: 0, serious: 2 }),
      sample({ id: 2, collisions: 20, fatal: 1, serious: 1 }),
      sample({ id: 3, collisions: 5, fatal: 3, serious: 0 }),
    ];
    expect(sortHotspots(list, "collisions").map((h) => h.id)).toEqual([2, 1, 3]);
    expect(sortHotspots(list, "fatal").map((h) => h.id)).toEqual([3, 2, 1]);
    expect(sortHotspots(list, "severe").map((h) => h.id)).toEqual([3, 2, 1]);
    expect(sortHotspots(list, "share").map((h) => h.id)).toEqual([3, 1, 2]);
  });

  it("draws only the largest 400 at zoom 6 or below, and everything above zoom 6", () => {
    const many = Array.from({ length: 500 }, (_, index) => sample({ id: index + 1, collisions: index + 1 }));
    expect(drawnHotspots(many, 6)).toHaveLength(400);
    expect(drawnHotspots(many, 6)[0]?.collisions).toBe(500);
    expect(drawnHotspots(many, 7)).toHaveLength(500);
  });
});

describe("CSV export", () => {
  it("writes a header and every API field, quoting text with commas", () => {
    const csv = buildCsv([sample({ id: 7, label: "Hill, North" })]);
    const [header, row] = csv.trim().split("\n");
    expect(header).toBe(
      "id,subset,slice,month,latitude,longitude,radius_m,collisions,fatal,serious,slight,label,years_present,persistence",
    );
    expect(row).toBe('7,severe,All times,,51.5,-0.12,200,10,1,4,5,"Hill, North",,');
  });

  it("leaves a missing label empty", () => {
    expect(buildCsv([sample({ label: null })]).trim().split("\n")[1]?.split(",")[11]).toBe("");
  });
});
