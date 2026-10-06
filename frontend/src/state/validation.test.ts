import { describe, expect, it } from "vitest";
import { clientErrors, UNDER_TEN_MESSAGE } from "./validation";

describe("client-side checks", () => {
  it("accepts an age under 10 only when a pedal cycle is ticked", () => {
    expect(clientErrors({ driver_ages: "9" }, ["car"]).driver_ages).toBe(UNDER_TEN_MESSAGE);
    expect(clientErrors({ driver_ages: "9" }, ["pedal_cycle"])).toEqual({});
  });

  it("rejects ages outside 1 to 105 and text that is not a whole number", () => {
    expect(clientErrors({ driver_ages: "0" }, []).driver_ages).toContain("from 1 to 105");
    expect(clientErrors({ driver_ages: "200" }, []).driver_ages).toContain("from 1 to 105");
    expect(clientErrors({ driver_ages: "34, old" }, []).driver_ages).toContain("from 1 to 105");
  });

  it("checks the vehicle count range and that it covers the ticked types", () => {
    expect(clientErrors({ number_of_vehicles: "31" }, []).number_of_vehicles).toBe("Enter a whole number from 1 to 30.");
    expect(clientErrors({ number_of_vehicles: "1" }, ["car", "pedal_cycle"]).number_of_vehicles).toBe(
      "You ticked 2 vehicle types, so there must be at least 2 vehicles.",
    );
  });

  it("does not add a required-field error, which the backend reports", () => {
    expect(clientErrors({}, [])).toEqual({});
  });
});
