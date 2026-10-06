import { useState } from "react";
import type { Hotspot } from "../api/endpoints";
import { useMaps } from "../maps/MapsContext";
import type { LatLng, MapControls, MapTarget, RouteOverlay, ViewState } from "../maps/types";
import { hotspotLabel, SMALL_ZOOM_LIMIT } from "../state/hotspotState";
import { PlaceSearchBox } from "./PlaceSearchBox";
import { StatusBox } from "./StatusBox";
import styles from "./hotspots.module.css";
import ui from "./ui.module.css";

export const INITIAL_CENTER: LatLng = { lat: 54.5, lng: -3 };
export const INITIAL_ZOOM = 6;

interface Props {
  hotspots: Hotspot[];
  selectedId: number | null;
  hovered: Hotspot | null;
  target: MapTarget | null;
  routes: RouteOverlay[];
  fitRoutes: boolean;
  initialCenter: LatLng;
  initialZoom: number;
  loading: boolean;
  error: string | null;
  // Set when the map is drawing only the largest hotspots, so the footer can say so.
  smallZoomNote: boolean;
  onViewChange: (view: ViewState) => void;
  onSelect: (id: number) => void;
  onClearSelection: () => void;
  onHover: (id: number | null) => void;
  onZoom: (delta: number) => void;
  onPlace: (point: LatLng, name: string) => void;
  // Set after a selection has zoomed the map in. Returns to the view from before.
  onBack: (() => void) | null;
}

export function HotspotMap(props: Props) {
  const maps = useMaps();
  const Canvas = maps.HotspotCanvas;
  const [controls, setControls] = useState<MapControls | null>(null);
  const zoomBy = (delta: number) => {
    if (controls) controls.zoomBy(delta);
    else props.onZoom(delta);
  };
  return (
    <div className={styles.mapWrap} aria-busy={props.loading}>
      {Canvas !== null && maps.ready ? (
        <Canvas
          initialCenter={props.initialCenter}
          initialZoom={props.initialZoom}
          hotspots={props.hotspots}
          selectedId={props.selectedId}
          target={props.target}
          routes={props.routes}
          fitRoutes={props.fitRoutes}
          onViewChange={props.onViewChange}
          onSelect={props.onSelect}
          onClearSelection={props.onClearSelection}
          onHover={props.onHover}
          onMap={setControls}
        />
      ) : (
        <div style={{ padding: 24 }}>
          <StatusBox tone="warn">The map could not load. The list still works.</StatusBox>
        </div>
      )}

      {props.loading ? (
        <div role="status" className={styles.mapOverlay} style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)", background: "#fff", borderRadius: 14, padding: "10px 16px", boxShadow: "var(--shadow-card)" }}>
          Loading hotspots...
        </div>
      ) : null}

      {props.error ? (
        <div className={styles.mapOverlay} style={{ left: 12, right: 12, bottom: 12 }}>
          <StatusBox tone="error" title="Hotspots could not load">
            {props.error}
          </StatusBox>
        </div>
      ) : null}

      {maps.placeSearch && maps.ready ? (
        <div className={`${styles.mapOverlay} ${styles.searchOverlay}`}>
          <PlaceSearchBox
            search={maps.placeSearch}
            onPick={(point, name) => {
              props.onPlace(point, name);
            }}
          />
        </div>
      ) : null}

      {maps.ready ? (
        <div className={`${styles.mapOverlay} ${styles.zoomOverlay}`}>
          <button type="button" className={styles.zoomButton} aria-label="Zoom in" onClick={() => {
            zoomBy(1);
          }}>
            +
          </button>
          <button type="button" className={styles.zoomButton} aria-label="Zoom out" onClick={() => {
            zoomBy(-1);
          }}>
            −
          </button>
        </div>
      ) : null}

      <div className={`${styles.mapOverlay} ${styles.legend}`} aria-label="Map legend">
        <div className={styles.legendRow}>
          <span className={styles.swatch} style={{ background: "rgba(166,30,25,0.30)", borderColor: "#A61E19" }} aria-hidden="true" />
          Includes Fatal
        </div>
        <div className={styles.legendRow}>
          <span className={styles.swatch} style={{ background: "rgba(245,183,31,0.38)", borderColor: "#9A5B00" }} aria-hidden="true" />
          Serious only
        </div>
        <div className={styles.legendRow}>
          <span className={styles.swatch} style={{ borderColor: "#0A3F86", borderWidth: 2 }} aria-hidden="true" />
          Selected
        </div>
      </div>

      {props.onBack || props.smallZoomNote ? (
        <div className={`${styles.mapOverlay} ${styles.bottomCentre}`}>
          {props.onBack ? (
            <button type="button" className={`${ui.btnSecondary} ${styles.backButton}`} onClick={props.onBack}>
              ← Back to all hotspots
            </button>
          ) : null}
          {props.smallZoomNote ? (
            <div className={styles.footerNote} role="note">
              Showing the {SMALL_ZOOM_LIMIT} largest. Zoom in for more.
            </div>
          ) : null}
        </div>
      ) : null}

      {props.hovered ? (
        <div className={`${styles.mapOverlay} ${styles.hoverCard}`} aria-hidden="true">
          <div style={{ fontWeight: 700 }}>{hotspotLabel(props.hovered)}</div>
          <div>
            {props.hovered.collisions} collisions: {props.hovered.fatal} Fatal, {props.hovered.serious} Serious
          </div>
          <div style={{ color: "var(--muted)" }}>Radius {Math.round(props.hovered.radius_m)} m</div>
          <div style={{ color: "var(--muted)" }}>Click for details</div>
        </div>
      ) : null}
    </div>
  );
}
