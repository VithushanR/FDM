import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { renderPage } from "../test/renderPage";
import { severeHotspots } from "../test/fixtures";
import { LIST_LIMIT, buildCsv, inBounds, sortHotspots, type Bounds } from "../state/hotspotState";
import { SCOTLAND_VIEW, GB_VIEW } from "../test/fakeMaps";
import type { Hotspot } from "../api/endpoints";

// What the test server returns for the default filters: Fatal and Serious, at least 5 collisions, most first.
function expectedList(source: Hotspot[], minimum: number, bounds?: Bounds): Hotspot[] {
  const filtered = source.filter((h) => h.collisions >= minimum && (bounds ? inBounds(h, bounds) : true));
  return sortHotspots(filtered, "collisions").slice(0, LIST_LIMIT);
}

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
    await screen.findByText(/hotspots in view/);
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
    renderPage("/hotspots");
    const gbList = expectedList(severeHotspots, 5, GB_VIEW.bounds);
    await screen.findByText(new RegExp(`Showing 6 of ${gbList.length} hotspots in the map view`));

    await user.click(screen.getByRole("button", { name: "View Scotland" }));
    const scotland = expectedList(severeHotspots, 5, SCOTLAND_VIEW.bounds);
    expect(scotland.length).toBeGreaterThanOrEqual(6);
    await screen.findByText(new RegExp(`Showing 6 of ${scotland.length} hotspots in the map view`));
  });
});

describe("features the backend does not provide yet", () => {
  it("disables Month, Persistence and Route check", async () => {
    renderPage("/hotspots");
    await screen.findByText(/hotspots in view/);
    expect(screen.getByRole("button", { name: "Month" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("title");
    expect(screen.getByLabelText("Persistence")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Route check" })).toBeDisabled();
  });
});

describe("list and details", () => {
  it("shows the truncation notice when the list is at the limit", async () => {
    renderPage("/hotspots");
    expect(
      await screen.findByText(/Only the first 1,000 hotspots for these filters are loaded/),
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
    renderPage("/hotspots");
    await screen.findByText(/hotspots in view/);
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
    await screen.findByText(/hotspots in view/);
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    await waitFor(() => { expect(screen.getByTestId("location-search")).toHaveTextContent("subset=severe&min=5"); });
  });

  it("reads the hotspot list from the URL on open", async () => {
    renderPage("/hotspots?subset=all&min=10");
    await waitFor(() => { expect(requested.some((url) => url.includes("subset=all") && url.includes("min_collisions=10"))).toBe(true); });
  });
});
