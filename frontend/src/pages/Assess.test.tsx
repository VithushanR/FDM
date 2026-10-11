import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { renderPage } from "../test/renderPage";
import { schema } from "../test/fixtures";
import predictStandard from "../test/fixtures/predict_standard.json";
import predictInvalid from "../test/fixtures/predict_invalid.json";
import unavailablePredict from "../test/fixtures/unavailable_predict.json";
import locationLondon from "../test/fixtures/location_london.json";
import { NETWORK_MESSAGE } from "../api/client";

const requiredFields = schema.groups
  .flatMap((group) => group.fields)
  .filter((field) => field.required && field.name !== "latitude" && field.name !== "longitude");

async function fillStandardInput(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2024-10-03" } });
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: "23:15" } });
  await user.selectOptions(screen.getByLabelText("Speed limit"), "60");
  await user.selectOptions(screen.getByLabelText("Area type"), "2");
  await user.selectOptions(screen.getByLabelText("Road layout"), "6");
  await user.selectOptions(screen.getByLabelText("Junction"), "13");
  await user.selectOptions(screen.getByLabelText("Lighting"), "6");
  await user.selectOptions(screen.getByLabelText("Weather"), "2");
  await user.selectOptions(screen.getByLabelText("Road surface"), "2");
  await user.type(screen.getByLabelText("Number of vehicles"), "2");
  await user.click(screen.getByLabelText("Car or taxi"));
  await user.click(screen.getByLabelText("Motorcycle"));
  await user.type(screen.getByLabelText("Driver ages"), "34, 52");
  await user.selectOptions(screen.getByLabelText("Trunk road"), "2");
}

describe("form built from the schema", () => {
  it("shows every schema field with its label, and counts the required answers", async () => {
    renderPage("/");
    expect(await screen.findByText(`0 of ${requiredFields.length} required answers entered`)).toBeInTheDocument();
    for (const field of schema.groups.flatMap((group) => group.fields)) {
      if (field.name === "latitude" || field.name === "longitude") continue;
      if (field.kind === "multicheck") {
        expect(screen.getByRole("group", { name: new RegExp(field.label) })).toBeInTheDocument();
      } else {
        expect(screen.getByLabelText(field.label)).toBeInTheDocument();
      }
    }
  });

  it("appends an unknown schema field instead of dropping it", async () => {
    const extra = {
      name: "mystery_flag",
      label: "Mystery thing",
      kind: "select",
      required: false,
      help: null,
      options: [{ value: "a", label: "Alpha" }],
      min: null,
      max: null,
      placeholder: null,
    };
    const patched = {
      ...schema,
      groups: schema.groups.map((group, index) => (index === 0 ? { ...group, fields: [...group.fields, extra] } : group)),
    };
    server.use(http.get("/api/schema", () => HttpResponse.json(patched)));
    renderPage("/");
    expect(await screen.findByLabelText("Mystery thing")).toBeInTheDocument();
  });

  it("sends selects as strings, numbers as numbers, and leaves blank optionals out", async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    server.use(
      http.post("/api/predict", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(predictStandard.body);
      }),
    );
    renderPage("/");
    await screen.findByLabelText("Date");
    await fillStandardInput(user);
    await user.click(screen.getByRole("button", { name: "Estimate severity" }));
    await waitFor(() => { expect(body).not.toBeNull(); });
    expect(body).toEqual({
      date: "2024-10-03",
      time: "23:15",
      speed_limit: "60",
      urban_or_rural_area: "2",
      road_type: "6",
      junction_detail: "13",
      light_conditions: "6",
      weather_conditions: "2",
      road_surface_conditions: "2",
      number_of_vehicles: 2,
      vehicles: ["car", "motorcycle"],
      driver_ages: "34, 52",
      trunk_road_flag: "2",
    });
  });
});

describe("validation", () => {
  it("shows every 422 problem at once, the footer count, and clears a field when it is edited", async () => {
    server.use(
      http.post("/api/predict", () =>
        HttpResponse.json(
          {
            errors: [
              { field: "date", message: "Enter a valid date." },
              { field: "time", message: "Enter a valid time, for example 18:30." },
              { field: "road_type", message: "Choose one of the listed options." },
              { field: "speed_limit", message: "Choose one of the listed options." },
              { field: "number_of_vehicles", message: "Enter a whole number from 1 to 30." },
              { field: "driver_ages", message: "Enter driver ages as whole numbers from 1 to 105." },
              { field: "latitude", message: "This location is more than 10 km from any collision in the data." },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage("/");
    await screen.findByLabelText("Date");
    await user.click(screen.getByRole("button", { name: "Estimate severity" }));

    expect(await screen.findByText("Fix 7 fields in the form, then estimate again.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid date.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid time, for example 18:30.")).toBeInTheDocument();
    expect(screen.getByText("Enter a whole number from 1 to 30.")).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Date")).toHaveAttribute("aria-describedby", "date-error");
    // The location error goes in the location box, not under a field.
    const locationBox = document.getElementById("location-status");
    expect(locationBox).toHaveTextContent("This location is more than 10 km from any collision in the data.");

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2024-10-03" } });
    await waitFor(() => { expect(screen.queryByText("Enter a valid date.")).not.toBeInTheDocument(); });
    expect(screen.getByText("Enter a valid time, for example 18:30.")).toBeInTheDocument();
  });

  it("shows the Needs fixing sign instead of a result", async () => {
    server.use(http.post("/api/predict", () => HttpResponse.json(predictInvalid.body, { status: 422 })));
    const user = userEvent.setup();
    renderPage("/");
    await screen.findByLabelText("Date");
    await user.click(screen.getByRole("button", { name: "Estimate severity" }));
    expect(await screen.findByRole("heading", { name: "Needs fixing" })).toBeInTheDocument();
  });
});

describe("location picker", () => {
  it("runs the coverage check when a pin settles, and not during a drag", async () => {
    const user = userEvent.setup();
    let checks = 0;
    server.use(
      http.post("/api/location/check", () => {
        checks += 1;
        return HttpResponse.json(locationLondon.body);
      }),
    );
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Start drag" }));
    expect(checks).toBe(0);
    await user.click(screen.getByRole("button", { name: "Click London" }));
    expect(await screen.findByText("Inside the area covered by the data")).toBeInTheDocument();
    expect(checks).toBe(1);
  });

  it("shows the sparse warning box with the API message", async () => {
    const message = "There is little recorded collision data near this location (the nearest is 4.2 km away), so the estimate relies on the rest of the data.";
    server.use(
      http.post("/api/location/check", () =>
        HttpResponse.json({ status: "sparse", nearest_km: 4.2, message, allowed: true }),
      ),
    );
    const user = userEvent.setup();
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Click London" }));
    expect(await screen.findByText("Little recorded collision data nearby")).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("shows the outside error, turns the pin red, and blocks the estimate", async () => {
    let predictCalls = 0;
    server.use(
      http.post("/api/predict", () => {
        predictCalls += 1;
        return HttpResponse.json(predictStandard.body);
      }),
    );
    const user = userEvent.setup();
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Click Belfast" }));
    expect(await screen.findByText("Outside the area the data covers")).toBeInTheDocument();
    expect(screen.getByText(/Move the pin or clear the location to continue\./)).toBeInTheDocument();
    expect(screen.getByTestId("fake-canvas")).toHaveAttribute("data-pin-status", "outside");
    await user.click(screen.getByRole("button", { name: "Estimate severity" }));
    expect(predictCalls).toBe(0);
    expect(document.getElementById("location-status")).toHaveFocus();
  });

  it("syncs the coordinate inputs with the pin", async () => {
    const user = userEvent.setup();
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Enter coordinates instead" }));
    await user.type(screen.getByLabelText("Latitude"), "51.5074");
    await user.type(screen.getByLabelText("Longitude"), "-0.1278");
    expect(await screen.findByText("Inside the area covered by the data")).toBeInTheDocument();
  });

  it("fills the coordinate inputs from a pin placed on the map", async () => {
    const user = userEvent.setup();
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Click London" }));
    await screen.findByText("Inside the area covered by the data");
    await user.click(screen.getByRole("button", { name: "Enter coordinates instead" }));
    expect(screen.getByLabelText("Latitude")).toHaveValue("51.507400");
    expect(screen.getByLabelText("Longitude")).toHaveValue("-0.127800");
  });

  it("falls back to coordinate inputs and a warning when the map cannot load", async () => {
    renderPage("/", { ready: false, Canvas: null, placeSearch: null, geocoder: null });
    expect(await screen.findByText("The map could not load. Enter coordinates instead.")).toBeInTheDocument();
    expect(screen.getByLabelText("Latitude")).toBeInTheDocument();
    expect(screen.getByLabelText("Longitude")).toBeInTheDocument();
  });

  it("selects a place from the search list with the keyboard", async () => {
    const user = userEvent.setup();
    renderPage("/");
    const search = await screen.findByRole("combobox", { name: /search for a place/i });
    await user.type(search, "big");
    const option = await screen.findByRole("option", { name: "Big Ben, London" });
    expect(option).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByRole("combobox", { name: /search for a place/i })).toHaveValue("Big Ben");
  });
});

describe("result", () => {
  it("shows Serious with the model numbers, reliability and left-blank list, with no mention of weighting", async () => {
    const user = userEvent.setup();
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Estimate severity" }));
    const heading = await screen.findByRole("heading", { name: "Serious", level: 2 });
    expect(heading).toHaveFocus();
    expect(screen.getByText("28%")).toBeInTheDocument();
    expect(screen.getByText("48%")).toBeInTheDocument();
    expect(screen.getByText("24%")).toBeInTheDocument();
    expect(screen.getAllByText("Model estimate for each class").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "In testing, 34% of collisions the model called Serious really were Serious, and it found 46% of all real Serious collisions.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Left blank: Road class, Junction control/)).toBeInTheDocument();
    expect(screen.getByText("This is a statistical estimate. It does not replace a police or medical assessment.")).toBeInTheDocument();
    expect(screen.queryByText(/Fatal counts/)).not.toBeInTheDocument();
    expect(screen.queryByText(/before weighting/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fatal weight/)).not.toBeInTheDocument();
  });

  it("shows the real Fatal false-alarm rate in the printed report's Limits section, for any verdict", async () => {
    const user = userEvent.setup();
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Estimate severity" }));
    await screen.findByRole("heading", { name: "Serious", level: 2 });
    const paper = document.querySelector(".report-paper") as HTMLElement;
    expect(
      within(paper).getByText(
        "Fatal collisions are rare, so a Fatal result is often a false alarm: in testing, about 1 in 14 Fatal results (7%) was a real fatal collision.",
      ),
    ).toBeInTheDocument();
  });

  it("shows what pushed the estimate, split into what raised and lowered the chance", async () => {
    const user = userEvent.setup();
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Estimate severity" }));
    await screen.findByRole("heading", { name: "Serious", level: 2 });
    expect(await screen.findAllByText("Motorcycle involved")).not.toHaveLength(0);
    expect(screen.getAllByText("Raised the chance of a more severe collision").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Lowered the chance of a more severe collision").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/These are patterns in past collision records/).length).toBeGreaterThan(0);
  });

  it("renders the API warnings", async () => {
    server.use(
      http.post("/api/predict", () =>
        HttpResponse.json({ ...predictStandard.body, warnings: ["Little recorded collision data nearby. Check it."] }),
      ),
    );
    const user = userEvent.setup();
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Estimate severity" }));
    await screen.findAllByText("Little recorded collision data nearby. Check it.");
    expect(screen.getAllByText("Little recorded collision data nearby. Check it.").length).toBeGreaterThan(0);
  });

  it("shows the red banner with the API message on a 503", async () => {
    server.use(http.post("/api/predict", () => HttpResponse.json(unavailablePredict.body, { status: 503 })));
    const user = userEvent.setup();
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Estimate severity" }));
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(NETWORK_MESSAGE);
    expect(banner).toHaveTextContent(unavailablePredict.body.error);
  });

  it("shows the report with the same facts, and copies a summary", async () => {
    const user = userEvent.setup();
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Estimate severity" }));
    await screen.findByRole("heading", { name: "Serious", level: 2 });
    const paper = document.querySelector(".report-paper") as HTMLElement;
    expect(within(paper).getByText("Collision severity assessment")).toBeInTheDocument();
    expect(within(paper).getByText("6. Limits")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print / Save as PDF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy summary" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save as PDF" })).not.toBeInTheDocument();
  });

  it("sets the document title while printing and restores it afterwards", async () => {
    const user = userEvent.setup();
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Estimate severity" }));
    await screen.findByRole("heading", { name: "Serious", level: 2 });
    const titleBefore = document.title;
    window.dispatchEvent(new Event("beforeprint"));
    expect(document.title).not.toBe(titleBefore);
    expect(document.title).toContain("Collision severity report");
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe(titleBefore);
  });

  it("calls window.print when the Print / Save as PDF button is clicked", async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Estimate severity" }));
    await screen.findByRole("heading", { name: "Serious", level: 2 });
    await user.click(screen.getByRole("button", { name: "Print / Save as PDF" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });

  it("shows the vehicle count with correct pluralisation, and driver ages as min, max and average", async () => {
    const user = userEvent.setup();
    renderPage("/");
    await screen.findByLabelText("Date");
    await fillStandardInput(user);
    await user.click(await screen.findByRole("button", { name: "Estimate severity" }));
    const paper = await (async () => {
      await screen.findByRole("heading", { name: "Serious", level: 2 });
      return document.querySelector(".report-paper") as HTMLElement;
    })();
    expect(within(paper).getByText(/2 vehicles: Car or taxi, Motorcycle/)).toBeInTheDocument();
    expect(within(paper).getByText("Min 34, max 52, average 43")).toBeInTheDocument();
  });

  it("shows a single vehicle as singular, and missing driver ages as Not given", async () => {
    const user = userEvent.setup();
    renderPage("/");
    await screen.findByLabelText("Date");
    await user.type(screen.getByLabelText("Number of vehicles"), "1");
    await user.click(screen.getByLabelText("Car or taxi"));
    await user.click(await screen.findByRole("button", { name: "Estimate severity" }));
    const paper = await (async () => {
      await screen.findByRole("heading", { name: "Serious", level: 2 });
      return document.querySelector(".report-paper") as HTMLElement;
    })();
    expect(within(paper).getByText(/1 vehicle: Car or taxi/)).toBeInTheDocument();
    expect(within(paper).getAllByText("Not given").length).toBeGreaterThan(0);
  });
});
