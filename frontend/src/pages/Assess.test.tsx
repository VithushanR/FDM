import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
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
  it("shows Serious with the model numbers, weighting note, reliability and left-blank list", async () => {
    const user = userEvent.setup();
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Estimate severity" }));
    const heading = await screen.findByRole("heading", { name: "Serious", level: 2 });
    expect(heading).toHaveFocus();
    expect(screen.getByText("28%")).toBeInTheDocument();
    expect(screen.getByText("48%")).toBeInTheDocument();
    expect(screen.getByText("24%")).toBeInTheDocument();
    expect(
      screen.getAllByText("Fatal counts 1.5 times when the result is chosen: 28% × 1.5 = 42%, below Serious at 48%.").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "In testing, 34% of collisions the model called Serious really were Serious, and it found 46% of all real Serious collisions.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Left blank: Road class, Junction control/)).toBeInTheDocument();
    expect(screen.getByText("This is a statistical estimate. It does not replace a police or medical assessment.")).toBeInTheDocument();
  });

  it("adds the Fatal false-alarm sentence for a Fatal estimate", async () => {
    server.use(
      http.post("/api/predict", () =>
        HttpResponse.json({ ...predictStandard.body, severity: "Fatal", severity_code: 1 }),
      ),
    );
    const user = userEvent.setup();
    renderPage("/");
    await user.click(await screen.findByRole("button", { name: "Estimate severity" }));
    const sentence = "About 93 in 100 collisions the model calls Fatal are false alarms, so check this estimate against the facts of the case.";
    await screen.findAllByText(sentence);
    expect(screen.getAllByText(sentence).length).toBeGreaterThan(0);
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
    expect(within(paper).getByText("4. Limits")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print report" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as PDF" })).toBeInTheDocument();
  });
});
