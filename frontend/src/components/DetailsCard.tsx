import { useEffect, useState } from "react";
import { getHotspotDetails, type DetailsOut, type Hotspot } from "../api/endpoints";
import { useMaps } from "../maps/MapsContext";
import { hotspotLabel, monthName } from "../state/hotspotState";
import { Frame } from "./Frame";
import { Pill } from "./Pill";
import styles from "./hotspots.module.css";
import ui from "./ui.module.css";

// The note that goes under the yearly chart. It is the text agreed for the page, with no numbers of our own.
const YEAR_NOTE = "Collisions in early 2021 were lower than in other years, probably because of the lockdown, so read the yearly bars with care.";

interface Props {
  hotspot: Hotspot | null;
  detailsOn: boolean;
  rules: Record<string, string> | null;
}

// Nothing is shown until a hotspot is selected. The list footer already says how to select one.
export function DetailsCard({ hotspot, detailsOn, rules }: Props) {
  if (!hotspot) return null;
  return <SelectedDetails key={hotspot.id} hotspot={hotspot} detailsOn={detailsOn} rules={rules} />;
}

function SelectedDetails({ hotspot, detailsOn, rules }: { hotspot: Hotspot; detailsOn: boolean; rules: Record<string, string> | null }) {
  const [details, setDetails] = useState<DetailsOut | null>(null);
  const [failed, setFailed] = useState(false);
  const [place, setPlace] = useState<string | null>(null);
  const maps = useMaps();

  useEffect(() => {
    if (!detailsOn) return;
    const controller = new AbortController();
    getHotspotDetails(hotspot.id, controller.signal)
      .then((body) => {
        setDetails(body);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        void error;
        setFailed(true);
      });
    return () => {
      controller.abort();
    };
  }, [detailsOn, hotspot.id]);

  // Hotspots without an LSOA get a place name from the geocoder, shown under the title.
  useEffect(() => {
    if (hotspot.label || !maps.geocoder) return;
    let active = true;
    maps.geocoder
      .reverse({ lat: hotspot.latitude, lng: hotspot.longitude })
      .then((name) => {
        if (active) setPlace(name);
      })
      .catch(() => {
        if (active) setPlace(null);
      });
    return () => {
      active = false;
    };
  }, [hotspot, maps.geocoder]);

  const subsetText = hotspot.subset === "severe" ? "Fatal and Serious collisions" : "All collisions";
  const sliceText = typeof hotspot.month === "number" ? monthName(hotspot.month) : hotspot.slice;
  return (
    <Frame>
      <section className={styles.details} style={{ padding: "22px 26px" }} aria-labelledby="details-heading">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <h2 id="details-heading" tabIndex={-1} className={ui.cardTitle} style={{ fontSize: 28 }}>
              Hotspot details: {hotspotLabel(hotspot)}
            </h2>
            {place ? <div style={{ fontWeight: 700 }}>{place}</div> : null}
            <p className={ui.muted} style={{ margin: 0 }}>
              Centre {hotspot.latitude.toFixed(5)}, {hotspot.longitude.toFixed(5)}. Radius {Math.round(hotspot.radius_m)} m.{" "}
              {subsetText}, {sliceText}.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <Pill label={hotspot.persistence} />
            {hotspot.years_present !== null ? (
              <span className={ui.muted} style={{ fontSize: 14 }}>
                Collisions in {hotspot.years_present} of 5 years
              </span>
            ) : null}
          </div>
        </div>

        <div className={styles.tiles}>
          <Tile label="Collisions" value={hotspot.collisions} />
          <Tile label="Fatal" value={hotspot.fatal} />
          <Tile label="Serious" value={hotspot.serious} />
          <Tile label="Radius (m)" value={Math.round(hotspot.radius_m)} />
        </div>

        {detailsOn && details ? <ProfileBlocks details={details} /> : null}
        {detailsOn && failed ? (
          <p role="status" className={ui.muted} style={{ margin: 0 }}>
            The charts could not load for this hotspot.
          </p>
        ) : null}

        {rules ? (
          <details>
            <summary style={{ cursor: "pointer", color: "var(--blue)", fontWeight: 700, minHeight: 44, display: "flex", alignItems: "center" }}>
              How persistence is decided
            </summary>
            <p className={ui.muted} style={{ margin: "6px 0 0", fontSize: 14 }}>
              Persistent: {rules["persistent"]}. Recent: {rules["recent"]}. Fading: {rules["fading"]}. Too few to judge: {rules["too_few_to_judge"]}.
            </p>
          </details>
        ) : null}
      </section>
    </Frame>
  );
}

function ProfileBlocks({ details }: { details: DetailsOut }) {
  const { profile } = details;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <BarChart
        title="By year"
        rows={profile.years.map((row) => ({ label: String(row.year), value: row.collisions }))}
        note={YEAR_NOTE}
      />
      <BarChart title="By month" rows={profile.months.map((row) => ({ label: monthName(row.month).slice(0, 1), value: row.collisions }))} />
      <BarChart title="By time of day" rows={profile.time_of_day.map((row) => ({ label: row.slice, value: row.collisions }))} />
      <section aria-labelledby="kinds-heading">
        <h3 id="kinds-heading" className={ui.cardTitle} style={{ fontSize: 22 }}>
          What kind of collisions happen here
        </h3>
        <div style={{ display: "grid", gap: 10 }}>
          {profile.shares.map((share) => (
            <div key={share.key} style={{ display: "grid", gridTemplateColumns: "minmax(160px, 1fr) minmax(160px, 2fr) 170px", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 15 }}>{share.label}</span>
              <div style={{ position: "relative", height: 16, background: "#E1E6EA", borderRadius: 8 }}>
                <div style={{ width: `${Math.min(100, share.here_pct)}%`, height: "100%", background: "var(--blue)", borderRadius: 8 }} />
                <div
                  data-testid={`gb-tick-${share.key}`}
                  style={{ position: "absolute", top: -4, bottom: -4, left: `${Math.min(100, share.gb_pct)}%`, width: 2, background: "#000" }}
                />
              </div>
              <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
                {share.here_pct}% here, {share.gb_pct}% GB
              </span>
            </div>
          ))}
        </div>
        <p className={ui.muted} style={{ fontSize: 13, margin: "8px 0 0" }}>
          Blue bar: share of this hotspot&apos;s collisions. Black tick: share across all Fatal and Serious collisions in Great Britain.
        </p>
      </section>
    </div>
  );
}

function BarChart({ title, rows, note }: { title: string; rows: { label: string; value: number }[]; note?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <section aria-label={title}>
      <h3 className={ui.cardTitle} style={{ fontSize: 22 }}>{title}</h3>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
        {rows.map((row) => (
          <div key={row.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
            <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{row.value}</span>
            <div style={{ width: "100%", height: `${Math.round((row.value / max) * 90)}px`, background: "var(--blue)", borderRadius: "6px 6px 0 0", minHeight: 2 }} />
            <span style={{ fontSize: 12 }}>{row.label}</span>
          </div>
        ))}
      </div>
      {note ? <p className={ui.muted} style={{ fontSize: 13, margin: "6px 0 0" }}>{note}</p> : null}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.tile}>
      <div className={ui.muted} style={{ fontSize: 14, fontWeight: 700 }}>
        {label}
      </div>
      <div className={styles.tileValue}>{value.toLocaleString("en-GB")}</div>
    </div>
  );
}
