import type { FieldError, NormalisedError } from "../api/client";
import type { FormGroup } from "../api/endpoints";
import type { LatLng } from "../maps/types";

export type FormValues = Record<string, string>;

export const LOCATION_FIELDS = new Set(["latitude", "longitude"]);

// Builds the body for POST /api/predict. Blank optional fields are left out, never sent as empty strings.
export function buildPayload(
  groups: FormGroup[],
  values: FormValues,
  vehicles: string[],
  pin: LatLng | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const group of groups) {
    for (const field of group.fields) {
      if (LOCATION_FIELDS.has(field.name)) continue;
      if (field.kind === "multicheck") {
        if (vehicles.length > 0) payload[field.name] = vehicles;
        continue;
      }
      const raw = (values[field.name] ?? "").trim();
      if (raw === "") continue;
      payload[field.name] = field.kind === "integer" ? Number(raw) : raw;
    }
  }
  if (pin) {
    payload["latitude"] = pin.lat;
    payload["longitude"] = pin.lng;
  }
  return payload;
}

export function requiredCount(groups: FormGroup[]): number {
  return groups.flatMap((group) => group.fields).filter((field) => field.required && !LOCATION_FIELDS.has(field.name)).length;
}

export function splitErrors(errors: FieldError[]): { fields: Record<string, string>; location: string[] } {
  const fields: Record<string, string> = {};
  const location: string[] = [];
  for (const error of errors) {
    if (LOCATION_FIELDS.has(error.field)) {
      location.push(error.message);
    } else if (fields[error.field] === undefined) {
      fields[error.field] = error.message;
    }
  }
  return { fields, location };
}

export function errorCount(normalised: NormalisedError): number {
  return normalised.errors?.length ?? 0;
}
