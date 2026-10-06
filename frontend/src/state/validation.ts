// Checks the form before it is sent, using the same rules and wording as the backend. The backend stays the
// authority: these only stop an obviously wrong answer from being sent.

export const AGE_RANGE_MESSAGE =
  "Enter driver ages as whole numbers from 1 to 105, separated by commas, for example 34, 52.";
export const UNDER_TEN_MESSAGE = "Ages under 10 are only allowed when a pedal cycle is involved.";
export const VEHICLE_COUNT_MESSAGE = "Enter a whole number from 1 to 30.";

export function clientErrors(values: Record<string, string>, vehicles: string[]): Record<string, string> {
  const errors: Record<string, string> = {};

  let vehicleCount: number | null = null;
  const countText = (values["number_of_vehicles"] ?? "").trim();
  if (countText !== "") {
    const count = Number(countText);
    if (!Number.isInteger(count) || count < 1 || count > 30) {
      errors["number_of_vehicles"] = VEHICLE_COUNT_MESSAGE;
    } else {
      vehicleCount = count;
    }
  }

  const agesText = (values["driver_ages"] ?? "").trim();
  if (agesText !== "") {
    const tokens = agesText.split(/[,;\s]+/).filter((token) => token !== "");
    const ages = tokens.map(Number);
    const wholeNumbers = tokens.every((token) => /^\d+$/.test(token));
    if (!wholeNumbers || ages.some((age) => age < 1 || age > 105)) {
      errors["driver_ages"] = AGE_RANGE_MESSAGE;
    } else if (ages.some((age) => age < 10) && !vehicles.includes("pedal_cycle")) {
      errors["driver_ages"] = UNDER_TEN_MESSAGE;
    } else if (vehicleCount !== null && ages.length > vehicleCount) {
      errors["driver_ages"] =
        `You entered ${ages.length} driver ages for ${vehicleCount} vehicles. Enter at most one age per vehicle.`;
    }
  }

  if (vehicleCount !== null && vehicles.length > vehicleCount) {
    errors["number_of_vehicles"] =
      `You ticked ${vehicles.length} vehicle types, so there must be at least ${vehicles.length} vehicles.`;
  }
  return errors;
}
