import { Link } from "react-router-dom";
import type { NearbyOut } from "../api/hotspotContract";
import { hotspotLabel } from "../state/hotspotState";
import { Frame } from "./Frame";
import { Pill } from "./Pill";
import styles from "./ui.module.css";

// Hotspots around the pin (severe, centre within 500 m). Shown only when the backend reports the nearby feature.
export function NearbyCard({
  items,
  failed,
  lat,
  lng,
}: {
  items: NearbyOut[] | null;
  failed: boolean;
  lat: number;
  lng: number;
}) {
  if (failed) return null;
  const count = items?.length ?? 0;
  const mapLink = `/hotspots?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&z=15&subset=severe`;
  return (
    <Frame>
      <section style={{ padding: "22px 26px" }} aria-labelledby="nearby-heading">
        <h3 id="nearby-heading" className={styles.cardTitle}>Hotspots near this location</h3>
        <p className={styles.muted} style={{ margin: "0 0 12px" }}>
          {items === null
            ? "Loading hotspots..."
            : count > 0
              ? `${count} Fatal and Serious hotspots lie within 500 m of the pin. A hotspot is a place where past collisions cluster. It is not a prediction.`
              : "No Fatal or Serious hotspot lies within 500 m of the pin."}
        </p>
        {items !== null && count > 0 ? (
          <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {items.map((item) => (
              <li
                key={item.id}
                style={{ border: "1px solid var(--hairline)", borderRadius: 16, padding: "10px 14px", background: "#fff" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-head)", fontSize: 24, fontWeight: 700 }}>
                    {item.distance_m} m away
                  </span>
                  <Pill label={item.persistence} />
                </div>
                <div style={{ fontSize: 15 }}>
                  <strong>{item.collisions} collisions</strong>: {item.fatal} Fatal, {item.serious} Serious
                </div>
                <div className={styles.muted} style={{ fontSize: 13 }}>
                  {hotspotLabel(item)}
                  {item.busiest_time ? `. Most in the ${item.busiest_time.toLowerCase()}` : ""}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
        <p style={{ margin: "12px 0 0" }}>
          <Link to={mapLink}>Open the hotspot map here</Link>
        </p>
      </section>
    </Frame>
  );
}
