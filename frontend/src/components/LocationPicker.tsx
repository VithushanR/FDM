import { useEffect, useRef, useState, type RefObject } from "react";
import { postLocationCheck, type Hotspot } from "../api/endpoints";
import { useAssess } from "../state/assessStore";
import type { LatLng, MapControls } from "../maps/types";
import { useMaps } from "../maps/MapsContext";
import { Field } from "./Field";
import { PlaceSearchBox } from "./PlaceSearchBox";
import { StatusBox, type StatusTone } from "./StatusBox";
import styles from "./ui.module.css";

export const LOCATION_STATUS_ID = "location-status";
const GB_BOX = { lat: [49, 61] as const, lng: [-9, 2.5] as const };
const PAIR_MESSAGE = "Enter latitude and longitude together, or leave both blank.";

function parseCoordinate(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() === "" || !Number.isFinite(value) ? null : value;
}

function inBox(point: LatLng): boolean {
  return point.lat >= GB_BOX.lat[0] && point.lat <= GB_BOX.lat[1] && point.lng >= GB_BOX.lng[0] && point.lng <= GB_BOX.lng[1];
}

export function LocationPicker({ statusRef, nearby }: { statusRef: RefObject<HTMLDivElement>; nearby: Hotspot[] }) {
  const { state, dispatch } = useAssess();
  const maps = useMaps();
  const [controls, setControls] = useState<MapControls | null>(null);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);

  // Runs the coverage check for a settled pin. Geocoding only on click or drag end, never while typing.
  async function settle(point: LatLng, options: { name?: string; geocode: boolean }) {
    const current = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    dispatch({ type: "setPin", pin: { ...point, name: options.name } });
    dispatch({
      type: "setLocation",
      location: { status: "none", nearest_km: null, message: null, checking: true },
    });

    if (options.geocode && !options.name) {
      void (maps.geocoder ? maps.geocoder.reverse(point).catch(() => null) : Promise.resolve(null)).then((name) => {
        if (current === sequence.current) {
          dispatch({ type: "setPin", pin: { ...point, name: name ?? "Selected point" } });
        }
      });
    }

    try {
      const check = await postLocationCheck(point.lat, point.lng, abort.signal);
      if (current !== sequence.current) return;
      dispatch({
        type: "setLocation",
        location: { status: check.status, nearest_km: check.nearest_km, message: check.message, checking: false },
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (current !== sequence.current) return;
      dispatch({
        type: "setLocation",
        location: { status: "unchecked", nearest_km: null, message: null, checking: false },
      });
    }
  }

  useEffect(() => () => controller.current?.abort(), []);

  function clearLocation() {
    sequence.current++;
    controller.current?.abort();
    dispatch({ type: "setPin", pin: null });
    dispatch({ type: "setCoordinateText", latText: "", lngText: "" });
    dispatch({ type: "setErrors", errors: state.errors, locationErrors: [] });
  }

  function onCoordinateChange(next: { latText?: string; lngText?: string }) {
    const latText = next.latText ?? state.latText;
    const lngText = next.lngText ?? state.lngText;
    dispatch({ type: "setCoordinateText", latText, lngText });
    const lat = parseCoordinate(latText);
    const lng = parseCoordinate(lngText);
    const filled = [latText.trim() !== "", lngText.trim() !== ""].filter(Boolean).length;
    if (filled === 1) {
      dispatch({ type: "setErrors", errors: state.errors, locationErrors: [PAIR_MESSAGE] });
      return;
    }
    dispatch({ type: "setErrors", errors: state.errors, locationErrors: [] });
    if (lat === null || lng === null) {
      dispatch({ type: "setPin", pin: null });
      return;
    }
    const point = { lat, lng };
    if (!inBox(point)) {
      dispatch({ type: "setPin", pin: null });
      dispatch({
        type: "setErrors",
        errors: state.errors,
        locationErrors: [`Enter latitude from ${GB_BOX.lat[0]} to ${GB_BOX.lat[1]} and longitude from ${GB_BOX.lng[0]} to ${GB_BOX.lng[1]}.`],
      });
      return;
    }
    void settle(point, { geocode: false });
  }

  const status = state.location;
  const pinStatus = !state.pin ? "none" : status?.checking ? "none" : (status?.status ?? "none");
  const tone: StatusTone | null = !state.pin || !status || status.checking
    ? null
    : status.status === "covered"
      ? "ok"
      : status.status === "sparse"
        ? "warn"
        : status.status === "outside"
          ? "error"
          : "muted";

  const Canvas = maps.Canvas;
  const showMap = Canvas !== null && state.locationMode === "map";

  return (
    <div className={styles.field} style={{ gap: 10 }}>
      {showMap && maps.placeSearch ? (
        <PlaceSearchBox
          search={maps.placeSearch}
          onPick={(point, name) => void settle(point, { name, geocode: false })}
        />
      ) : null}

      {!showMap ? (
        <>
          {!maps.ready ? (
            <StatusBox tone="warn">The map could not load. Enter coordinates instead.</StatusBox>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field id="latitude" label="Latitude" span={1}>
              {(a11y) => (
                <input
                  id="latitude"
                  className={styles.control}
                  inputMode="decimal"
                  value={state.latText}
                  onChange={(event) => { onCoordinateChange({ latText: event.target.value }); }}
                  {...a11y}
                />
              )}
            </Field>
            <Field id="longitude" label="Longitude" span={1}>
              {(a11y) => (
                <input
                  id="longitude"
                  className={styles.control}
                  inputMode="decimal"
                  value={state.lngText}
                  onChange={(event) => { onCoordinateChange({ lngText: event.target.value }); }}
                  {...a11y}
                />
              )}
            </Field>
          </div>
        </>
      ) : null}

      {Canvas !== null && showMap ? (
        <div
          style={{
            position: "relative",
            height: "clamp(380px, 52vh, 640px)",
            borderRadius: 18,
            overflow: "hidden",
            border: "1.5px solid #D2D8DE",
          }}
        >
          <Canvas
            center={{ lat: 54.5, lng: -3.0 }}
            zoom={6}
            pin={state.pin}
            pinStatus={pinStatus}
            restrictToGreatBritain
            hotspots={nearby}
            onMap={setControls}
            onPick={(point) => void settle(point, { geocode: true })}
            onPinDragEnd={(point) => void settle(point, { geocode: true })}
          />
          <div style={{ position: "absolute", top: 12, right: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <button type="button" className={styles.btnSecondary} style={{ width: 44, padding: 0 }} aria-label="Zoom in" onClick={() => { controls?.zoomBy(1); }}>+</button>
            <button type="button" className={styles.btnSecondary} style={{ width: 44, padding: 0 }} aria-label="Zoom out" onClick={() => { controls?.zoomBy(-1); }}>−</button>
          </div>
          {!state.pin ? (
            <div
              className={styles.pill}
              style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "#fff", boxShadow: "var(--shadow-card)", whiteSpace: "nowrap" }}
            >
              Click the map to place a pin
            </div>
          ) : null}
        </div>
      ) : null}

      <div id={LOCATION_STATUS_ID} ref={statusRef} tabIndex={-1}>
        {state.locationErrors.length > 0 ? (
          <StatusBox tone="error" title="Check the location">
            {state.locationErrors.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </StatusBox>
        ) : !state.pin ? (
          <div className={styles.muted} style={{ fontSize: 14 }}>
            Optional. A location makes the estimate more specific and shows the hotspots around it.
          </div>
        ) : status?.checking ? (
          <StatusBox tone="muted">Checking location...</StatusBox>
        ) : status && tone ? (
          <StatusBox tone={tone} title={titleFor(status.status)}>
            {textFor(status)}
          </StatusBox>
        ) : null}
      </div>

      {state.pin ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{state.pin.name ?? "Selected point"}</div>
            <div className={styles.muted} style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
              {state.pin.lat.toFixed(5)}, {state.pin.lng.toFixed(5)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className={styles.btnLink} onClick={clearLocation}>
              Clear location
            </button>
          </div>
        </div>
      ) : null}

      <div>
        <button
          type="button"
          className={styles.btnLink}
          onClick={() => {
            const toCoordinates = state.locationMode === "map";
            dispatch({ type: "setMode", mode: toCoordinates ? "coordinates" : "map" });
            // Keep the inputs in sync with the pin when switching to them.
            if (toCoordinates && state.pin) {
              dispatch({ type: "setCoordinateText", latText: state.pin.lat.toFixed(6), lngText: state.pin.lng.toFixed(6) });
            }
          }}
          disabled={!maps.ready}
        >
          {state.locationMode === "map" ? "Enter coordinates instead" : "Use the map instead"}
        </button>
      </div>
    </div>
  );
}

function titleFor(status: string): string {
  switch (status) {
    case "covered":
      return "Inside the area covered by the data";
    case "sparse":
      return "Little recorded collision data nearby";
    case "outside":
      return "Outside the area the data covers";
    default:
      return "Location recorded";
  }
}

function textFor(status: { status: string; nearest_km: number | null; message: string | null }): string {
  if (status.status === "covered") {
    return `The nearest recorded collision is ${status.nearest_km?.toFixed(1) ?? "?"} km away.`;
  }
  if (status.status === "outside") {
    return `${status.message ?? ""} Move the pin or clear the location to continue.`;
  }
  if (status.status === "unchecked") {
    return "No coverage check is available for this location.";
  }
  return status.message ?? "";
}
