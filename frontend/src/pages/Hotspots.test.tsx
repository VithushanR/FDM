import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { renderPage } from "../test/renderPage";
import { severeHotspots } from "../test/fixtures";
import alongRoute from "../test/fixtures/along_route_manchester_sheffield.json";
import hotspotsMeta from "../test/fixtures/hotspots_meta.json";
import hotspotsSevere from "../test/fixtures/hotspots_severe_all_times.json";
import { LIST_LIMIT, buildCsv, hotspotLabel, inBounds, sortHotspots, type Bounds } from "../state/hotspotState";
import { SCOTLAND_VIEW, GB_VIEW } from "../test/fakeMaps";
import type { Hotspot } from "../api/endpoints";

// What the test server returns for the default filters: Fatal and Serious, at least 5 collisions, most first.
function expectedList(source: Hotspot[], minimum: number, bounds?: Bounds): Hotspot[] {
  const filtered = source.filter((h) => h.collisions >= minimum && (bounds ? inBounds(h, bounds) : true));
  return sortHotspots(filtered, "collisions").slice(0, LIST_LIMIT);
}

// The meta endpoint as an older backend answers it: no bbox, months, persistence or route.
function withoutFeatures() {
  server.use(
    http.get("/api/hotspots/meta", () => HttpResponse.json({ ...hotspotsMeta.body, features: {} })),
  );
}

// The footer under the list, once it has loaded.
const LIST_LOADED = /hotspots shown\./;

const requested: string[] = [];

beforeEach(() => {
  requested.length = 0;
  server.events.on("request:start", ({ request }) => {
    if (new URL(request.url).pathname === "/api/hotspots") requested.push(request.url);
  });
});

afterEach(() => {
  server.events.removeAllListeners();
});

describe("hotspot query", () => {
  it("asks for Fatal and Serious at least 5 collisions by default", async () => {
    renderPage("/hotspots");
    await waitFor(() => { expect(requested.length).toBeGreaterThan(0); });
    const url = new URL(requested[0] ?? "", "http://test");
    expect(url.searchParams.get("subset")).toBe("severe");
    expect(url.searchParams.get("slice")).toBe("All times");
    expect(url.searchParams.get("min_collisions")).toBe("5");
    expect(url.searchParams.get("limit")).toBe("1000");
  });

  it("changes the minimum with the subset, and sends the time-of-day slice", async () => {
    const user = userEvent.setup();
    renderPage("/hotspots");
    await screen.findByText(LIST_LOADED);
    await user.click(screen.getByRole("button", { name: "All collisions" }));
    await waitFor(() => { expect(requested.some((url) => url.includes("subset=all") && url.includes("min_collisions=10"))).toBe(true); });

    await user.click(screen.getByRole("button", { name: "Time of day" }));
    await user.selectOptions(screen.getByLabelText("Time of day"), "Night");
    await waitFor(() => { expect(requested.some((url) => url.includes("slice=Night"))).toBe(true); });
  });
});

describe("viewport filtering without bbox support", () => {
  it("shows the hotspots inside the current map view, and changes when the view moves", async () => {
    const user = userEvent.setup();
    withoutFeatures();
    renderPage("/hotspots");
    const total = severeHotspots.filter((h) => h.collisions >= 5).length.toLocaleString("en-GB");
    const gbList = expectedList(severeHotspots, 5, GB_VIEW.bounds);
    await screen.findByText(new RegExp(`${gbList.length} of ${total} hotspots shown`));

    await user.click(screen.getByRole("button", { name: "View Scotland" }));
    const scotland = expectedList(severeHotspots, 5, SCOTLAND_VIEW.bounds);
    expect(scotland.length).toBeGreaterThanOrEqual(6);
    await screen.findByText(new RegExp(`${scotland.length} of ${total} hotspots shown`));
  });
});

describe("features the backend does not provide yet", () => {
  it("disables Month, Persistence and Route check", async () => {
    withoutFeatures();
    renderPage("/hotspots");
    await screen.findByText(LIST_LOADED);
    expect(screen.getByRole("button", { name: "Month" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("title");
    expect(screen.getByLabelText("Persistence")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Route check" })).toBeDisabled();
  });
});

describe("route check", () => {
  it("lists the hotspots along the route as a table, and selects one on click", async () => {
    const user = userEvent.setup();
    renderPage("/hotspots");
    await screen.findByText(LIST_LOADED);
    await user.click(screen.getByRole("button", { name: "Route check" }));
    for (const label of ["From", "To"]) {
      await user.type(screen.getByRole("combobox", { name: label }), "Big Ben");
      await user.click(await screen.findByRole("option", { name: "Big Ben, London" }));
    }
    await user.click(await screen.findByRole("button", { name: "Check route" }));

    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["Km", "Area", "Collisions", "Persistence"]);
    const first = alongRoute.body.hotspots[0];
    if (!first) throw new Error("no hotspots in the route fixture");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(alongRoute.body.hotspots.length);
    expect(rows[0]).toHaveTextContent(`${first.km_from_start.toFixed(1)}${first.label}${first.collisions}${first.persistence}`);

    await user.click(within(table).getAllByRole("button", { name: first.label })[0] as HTMLElement);
    expect(screen.getByTestId("fake-hotspot-canvas")).toHaveAttribute("data-selected", String(first.id));
    expect(screen.getByTestId("fake-hotspot-canvas")).toHaveAttribute(
      "data-target",
      `${first.latitude},${first.longitude},14`,
    );
    expect(await screen.findByText(new RegExp(`Hotspot details: ${first.label}`))).toBeInTheDocument();
  });
});

describe("list and details", () => {
  it("shows the truncation notice when the list is at the limit", async () => {
    // The captured response, which says how many matched beyond the 1,000 sent.
    server.use(http.get("/api/hotspots", () => HttpResponse.json(hotspotsSevere.body)));
    renderPage("/hotspots");
    expect(
      await screen.findByText(
        new RegExp(`Showing the 1,000 largest of ${hotspotsSevere.body.total_matched.toLocaleString("en-GB")} hotspots`),
      ),
    ).toBeInTheDocument();
  });

  it("selecting a row shows its details and writes the id to the URL", async () => {
    const user = userEvent.setup();
    renderPage("/hotspots");
    const top = expectedList(severeHotspots, 5, GB_VIEW.bounds)[0];
    if (!top) throw new Error("no hotspots in the fixture");
    const row = await screen.findByRole("button", { name: new RegExp(`LSOA ${top.label?.replace("LSOA ", "") ?? ""}`) });
    await user.click(row);
    expect(await screen.findByRole("heading", { name: `Hotspot details: LSOA ${top.label?.replace(/^LSOA\s*/, "") ?? ""}` })).toBeInTheDocument();
    expect(screen.getByTestId("location-search")).toHaveTextContent(`id=${top.id}`);
  });

  it("selecting a row flies the map to that hotspot at street zoom", async () => {
    const user = userEvent.setup();
    renderPage("/hotspots");
    const top = expectedList(severeHotspots, 5, GB_VIEW.bounds)[0];
    if (!top) throw new Error("no hotspots in the fixture");
    await user.click(await screen.findByRole("button", { name: new RegExp(hotspotLabel(top)) }));
    expect(screen.getByTestId("fake-hotspot-canvas")).toHaveAttribute(
      "data-target",
      `${top.latitude},${top.longitude},14`,
    );
  });

  it("goes back to the view from before the first selection, and clears it", async () => {
    const user = userEvent.setup();
    renderPage("/hotspots");
    expect(screen.queryByRole("button", { name: /Back to all hotspots/ })).not.toBeInTheDocument();
    const rows = await screen.findAllByRole("button", { name: /^LSOA|^Area near/ });
    const [first, second] = rows;
    if (!first || !second) throw new Error("not enough rows");
    // Two selections in a row still go back to the wide view, not to the first hotspot.
    await user.click(first);
    await user.click(second);
    await user.click(screen.getByRole("button", { name: /Back to all hotspots/ }));

    const canvas = screen.getByTestId("fake-hotspot-canvas");
    expect(canvas).toHaveAttribute("data-target", `${GB_VIEW.center.lat},${GB_VIEW.center.lng},${GB_VIEW.zoom}`);
    expect(canvas).toHaveAttribute("data-selected", "");
    expect(screen.queryByRole("button", { name: /Back to all hotspots/ })).not.toBeInTheDocument();
  });

  it("clears the selection on a click on the empty map, or on Escape", async () => {
    const user = userEvent.setup();
    renderPage("/hotspots");
    const [first] = await screen.findAllByRole("button", { name: /Select on map/ });
    if (!first) throw new Error("no map buttons");
    await user.click(first);
    expect(await screen.findByText(/Hotspot details:/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Click empty map" }));
    await waitFor(() => { expect(screen.queryByText(/Hotspot details:/)).not.toBeInTheDocument(); });
    expect(screen.getByTestId("location-search")).not.toHaveTextContent("id=");

    await user.click(first);
    expect(await screen.findByText(/Hotspot details:/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => { expect(screen.queryByText(/Hotspot details:/)).not.toBeInTheDocument(); });
  });

  it("selecting a circle on the map selects the same hotspot", async () => {
    const user = userEvent.setup();
    renderPage("/hotspots");
    const [first] = await screen.findAllByRole("button", { name: /Select on map/ });
    if (!first) throw new Error("no map buttons");
    const id = first.textContent?.replace("Select on map ", "") ?? "";
    await user.click(first);
    expect(screen.getByTestId("fake-hotspot-canvas")).toHaveAttribute("data-selected", id);
    expect(await screen.findByText(/Hotspot details:/)).toBeInTheDocument();
  });

  it("exports exactly the hotspots in view, with every field", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:test");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    // Without bbox the export is filtered to the view in the browser, which is what this checks.
    withoutFeatures();
    renderPage("/hotspots");
    await screen.findByText(LIST_LOADED);
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    const blob = createObjectURL.mock.calls[0]?.[0];
    if (!blob) throw new Error("no blob was created");
    const expected = buildCsv(sortHotspots(expectedList(severeHotspots, 5, GB_VIEW.bounds), "collisions"));
    expect(blob.size).toBe(expected.length);
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    // jsdom has no object URLs, so the stubs are removed again.
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
    click.mockRestore();
  });

  it("resets the filters to the defaults", async () => {
    const user = userEvent.setup();
    renderPage("/hotspots?subset=all&min=12");
    await screen.findByText(LIST_LOADED);
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    await waitFor(() => { expect(screen.getByTestId("location-search")).toHaveTextContent("subset=severe&min=5"); });
  });

  it("reads the hotspot list from the URL on open", async () => {
    renderPage("/hotspots?subset=all&min=10");
    await waitFor(() => { expect(requested.some((url) => url.includes("subset=all") && url.includes("min_collisions=10"))).toBe(true); });
  });
});
