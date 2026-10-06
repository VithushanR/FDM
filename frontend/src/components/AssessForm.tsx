import { useRef, type FormEvent } from "react";
import { ApiError, NETWORK_MESSAGE } from "../api/client";
import { postPredict, type FormField, type FormGroup, type Hotspot } from "../api/endpoints";
import { useAssess } from "../state/assessStore";
import { buildPayload, errorCount, requiredCount, splitErrors, type FormValues } from "../state/payload";
import { clientErrors } from "../state/validation";
import { Field, type ControlA11y } from "./Field";
import { LOCATION_STATUS_ID, LocationPicker } from "./LocationPicker";
import styles from "./ui.module.css";

// Where each known field sits on the screen, as in the design. Unknown schema fields are appended.
const REQUIRED_LAYOUT: [string, number][][] = [
  [["date", 4], ["time", 4], ["speed_limit", 4]],
  [["urban_or_rural_area", 4], ["road_type", 4], ["junction_detail", 4]],
  [["light_conditions", 4], ["weather_conditions", 4], ["road_surface_conditions", 4]],
  [["number_of_vehicles", 4], ["vehicles", 8]],
];
const OPTIONAL_LAYOUT: [string, number][][] = [
  [["first_road_class", 3], ["trunk_road_flag", 3], ["junction_control", 3], ["pedestrian_crossing", 3]],
  [["special_conditions_at_site", 3], ["carriageway_hazards", 3], ["driver_ages", 6]],
];
const KNOWN_ORDER = [...REQUIRED_LAYOUT, ...OPTIONAL_LAYOUT].flat().map(([name]) => name);
const LOCATION = new Set(["latitude", "longitude"]);

interface Props {
  groups: FormGroup[];
  nearby: Hotspot[];
}

export function AssessForm({ groups, nearby }: Props) {
  const { state, dispatch } = useAssess();
  const locationRef = useRef<HTMLDivElement>(null);
  const fields = new Map<string, FormField>();
  for (const group of groups) for (const field of group.fields) fields.set(field.name, field);

  const required = requiredCount(groups);
  const entered = [...fields.values()].filter(
    (field) => field.required && !LOCATION.has(field.name) && isFilled(field, state.values, state.vehicles),
  ).length;

  const unknown = [...fields.values()].filter((field) => !KNOWN_ORDER.includes(field.name) && !LOCATION.has(field.name));
  const unknownRequired: [string, number][] = unknown.filter((f) => f.required).map((f) => [f.name, 6]);
  const unknownOptional: [string, number][] = unknown.filter((f) => !f.required).map((f) => [f.name, 6]);
  const requiredRows = unknownRequired.length > 0 ? [...REQUIRED_LAYOUT, unknownRequired] : REQUIRED_LAYOUT;
  const optionalRows = unknownOptional.length > 0 ? [...OPTIONAL_LAYOUT, unknownOptional] : OPTIONAL_LAYOUT;

  function renderRow(row: [string, number][]) {
    return row.map(([name, span]) => {
      const field = fields.get(name);
      if (!field) return null;
      if (field.kind === "multicheck") return <VehicleChips key={name} field={field} span={span} />;
      return (
        <Field key={name} id={name} label={field.label} span={span} error={state.errors[name]} helper={field.help ?? undefined}>
          {(a11y) => <Control field={field} value={state.values[name] ?? ""} a11y={a11y} />}
        </Field>
      );
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The same checks as the backend, run first so a clearly wrong answer is caught before the request.
    const local = clientErrors(state.values, state.vehicles);
    const localCount = Object.keys(local).length;
    if (localCount > 0) {
      dispatch({ type: "setErrors", errors: local, locationErrors: [] });
      dispatch({ type: "setSubmitError", error: { kind: "validation", message: `Fix ${localCount} fields in the form, then estimate again.` } });
      requestAnimationFrame(() => {
        focusFirstInvalid(local, false);
      });
      return;
    }
    if (state.location?.status === "outside") {
      // The location box already shows the outside message. Focus it and do not call the API.
      document.getElementById(LOCATION_STATUS_ID)?.focus();
      return;
    }
    dispatch({ type: "setSubmitting", submitting: true });
    dispatch({ type: "setSubmitError", error: null });
    dispatch({ type: "setErrors", errors: {}, locationErrors: [] });
    try {
      const payload = buildPayload(groups, state.values, state.vehicles, state.pin);
      const result = await postPredict(payload);
      dispatch({ type: "setResult", result });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.normalised.kind === "validation") {
        const { fields: fieldErrors, location } = splitErrors(error.normalised.errors ?? []);
        dispatch({ type: "setErrors", errors: fieldErrors, locationErrors: location });
        dispatch({ type: "setResult", result: "needs-fixing" });
        dispatch({
          type: "setSubmitError",
          error: { kind: "validation", message: `Fix ${errorCount(error.normalised)} fields in the form, then estimate again.` },
        });
        requestAnimationFrame(() => { focusFirstInvalid(fieldErrors, location.length > 0); });
      } else if (error instanceof ApiError) {
        dispatch({ type: "setResult", result: null });
        dispatch({ type: "setSubmitError", error: error.normalised });
      } else {
        dispatch({ type: "setResult", result: null });
        dispatch({ type: "setSubmitError", error: { kind: "network", message: NETWORK_MESSAGE } });
      }
    } finally {
      dispatch({ type: "setSubmitting", submitting: false });
    }
  }

  const footerAlert = state.submitError?.kind === "validation" ? state.submitError.message : null;

  return (
    <form onSubmit={(event) => void onSubmit(event)} aria-busy={state.submitting} noValidate>
      <div style={{ display: "grid", gridTemplateColumns: "58fr 42fr" }}>
        <div style={{ padding: "22px 28px 22px 26px", borderRight: "1px solid var(--hairline)" }}>
          <h2 className={styles.cardTitle}>Collision details</h2>
          <p className={styles.muted} style={{ margin: "0 0 14px", fontSize: 16 }}>
            Required answers first, optional below
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: "14px 16px" }}>
            {requiredRows.map((row, index) => (
              <div key={`required-${index}`} style={{ display: "contents" }}>
                {renderRow(row)}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 12px" }}>
            <span style={{ fontWeight: 700, color: "var(--muted)" }}>Add if known</span>
            <span style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: "14px 16px" }}>
            {optionalRows.map((row, index) => (
              <div key={`optional-${index}`} style={{ display: "contents" }}>
                {renderRow(row)}
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: "22px 26px 22px 28px" }}>
          <h2 className={styles.cardTitle}>Location</h2>
          <p className={styles.muted} style={{ margin: "0 0 14px", fontSize: 16 }}>
            Optional
          </p>
          <LocationPicker statusRef={locationRef} nearby={nearby} />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "16px 26px",
          borderTop: "1px solid var(--hairline)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" className={styles.btnPrimary} disabled={state.submitting}>
            {state.submitting ? "Estimating..." : "Estimate severity"}
          </button>
          <button type="button" className={styles.btnLink} onClick={() => { dispatch({ type: "clearForm" }); }}>
            Clear form
          </button>
          {footerAlert ? (
            <div role="alert" className={`${styles.statusBox} ${styles.statusError}`} style={{ padding: "8px 12px" }}>
              {footerAlert}
            </div>
          ) : null}
        </div>
        <div className={styles.muted} style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <span>
            {entered} of {required} required answers entered
          </span>
          {entered === required && required > 0 ? (
            <svg width="18" height="18" viewBox="0 0 24 24" role="img" aria-label="All required answers entered">
              <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="var(--ok-check)" strokeWidth="3" />
            </svg>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function isFilled(field: FormField, values: FormValues, vehicles: string[]): boolean {
  if (field.kind === "multicheck") return vehicles.length > 0;
  return (values[field.name] ?? "").trim() !== "";
}

function focusFirstInvalid(fieldErrors: Record<string, string>, hasLocation: boolean) {
  const first = KNOWN_ORDER.find((name) => fieldErrors[name] !== undefined);
  if (first) {
    document.getElementById(first === "vehicles" ? "vehicles-car" : first)?.focus();
    return;
  }
  if (hasLocation) document.getElementById(LOCATION_STATUS_ID)?.focus();
}

function VehicleChips({ field, span }: { field: FormField; span: number }) {
  const { state, dispatch } = useAssess();
  const error = state.errors["vehicles"];
  return (
    <fieldset
      className={styles.field}
      style={{ gridColumn: `span ${span}`, border: 0, padding: 0, margin: 0, minWidth: 0 }}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? "vehicles-error" : undefined}
    >
      <legend className={styles.label} style={{ marginBottom: 6 }}>
        {field.label} (tick all that apply)
      </legend>
      <div className={styles.chips}>
        {field.options.map((option) => {
          const checked = state.vehicles.includes(option.value);
          return (
            <label key={option.value} className={`${styles.chip} ${checked ? styles.chipChecked : ""}`}>
              <input
                id={`vehicles-${option.value}`}
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...state.vehicles, option.value]
                    : state.vehicles.filter((value) => value !== option.value);
                  dispatch({ type: "setVehicles", vehicles: next });
                }}
              />
              {option.label}
            </label>
          );
        })}
      </div>
      {error ? (
        <span id="vehicles-error" className={styles.errorText}>
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}

function Control({ field, value, a11y }: { field: FormField; value: string; a11y: ControlA11y }) {
  const { dispatch } = useAssess();
  const onChange = (next: string) => { dispatch({ type: "setValue", name: field.name, value: next }); };
  if (field.kind === "select") {
    return (
      <select id={field.name} className={styles.control} value={value} onChange={(event) => { onChange(event.target.value); }} {...a11y}>
        <option value="">{field.required ? "Choose..." : "Not specified"}</option>
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  const type = field.kind === "date" ? "date" : field.kind === "time" ? "time" : field.kind === "integer" ? "number" : "text";
  return (
    <input
      id={field.name}
      type={type}
      inputMode={field.kind === "integer" ? "numeric" : undefined}
      min={field.min ?? undefined}
      max={field.max ?? undefined}
      placeholder={field.placeholder ?? undefined}
      className={styles.control}
      value={value}
      onChange={(event) => { onChange(event.target.value); }}
      {...a11y}
    />
  );
}
