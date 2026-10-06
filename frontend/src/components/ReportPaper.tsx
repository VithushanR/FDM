import { useState } from "react";
import type { About, FormGroup, PredictResponse } from "../api/endpoints";
import type { NearbyOut } from "../api/hotspotContract";
import { hotspotLabel } from "../state/hotspotState";
import type { Pin } from "../state/assessStore";
import { MEANING, fatalFalseAlarmSentence, reliabilitySentence, weightingNote } from "../state/resultMath";
import { optionLabel } from "../state/labels";
import styles from "./result.module.css";
import { Frame } from "./Frame";
import ui from "./ui.module.css";

interface Props {
  result: PredictResponse;
  about: About;
  groups: FormGroup[];
  values: Record<string, string>;
  vehicles: string[];
  pin: Pin | null;
  modelName: string;
  nearby: NearbyOut[];
}

const LIMIT_TEXT = [
  "This is an estimate for a collision that has already been reported. It is not a pre-collision risk score.",
  "Fatal collisions are rare, so a Fatal estimate is often a false alarm. See the About page for the full test results.",
  "The estimate does not replace a police or medical assessment.",
];

function formatDate(value: string | undefined): string {
  if (!value) return "Not given";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function value(groups: FormGroup[], values: Record<string, string>, name: string): string | undefined {
  const raw = values[name];
  if (!raw) return undefined;
  return optionLabel(groups, name, raw) ?? raw;
}

// The plain-text summary for "Copy summary". Built from the same facts as the paper.
export function reportSummary(props: Props): string {
  const { result, groups, values, vehicles, pin } = props;
  const lines = [
    `Collision severity assessment: ${result.severity}`,
    `Model estimate: Slight ${Math.round((result.scores["Slight"] ?? 0) * 100)}%, Serious ${Math.round((result.scores["Serious"] ?? 0) * 100)}%, Fatal ${Math.round((result.scores["Fatal"] ?? 0) * 100)}%`,
    `Date and time: ${formatDate(values["date"])} ${values["time"] ?? ""}`.trim(),
    `Location: ${pin ? `${pin.name ?? "Selected point"} (${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)})` : "Not given"}`,
    `Vehicles: ${vehicles.map((v) => optionLabel(groups, "vehicles", v) ?? v).join(", ") || "Not given"}`,
    `Left blank: ${result.left_blank.join(", ") || "none"}`,
    "This is a statistical estimate. It does not replace a police or medical assessment.",
  ];
  return lines.join("\n");
}

export function ReportPaper(props: Props) {
  const { result, about, groups, values, vehicles, pin, modelName, nearby } = props;
  const [copied, setCopied] = useState("");
  const generated = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const reliability = reliabilitySentence(about, result.severity);
  const details: [string, string][] = [
    ["Date and time", `${formatDate(values["date"])}${values["time"] ? `, ${values["time"]}` : ""}`],
    ["Location", pin ? `${pin.name ?? "Selected point"}, ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` : "Not given"],
    ["Road", [value(groups, values, "road_type"), value(groups, values, "speed_limit"), value(groups, values, "urban_or_rural_area"), value(groups, values, "junction_detail"), value(groups, values, "first_road_class"), value(groups, values, "trunk_road_flag")].filter(Boolean).join(", ") || "Not given"],
    ["Conditions", [value(groups, values, "light_conditions"), value(groups, values, "weather_conditions"), value(groups, values, "road_surface_conditions")].filter(Boolean).join(", ") || "Not given"],
    ["Vehicles", vehicles.length > 0 ? `${values["number_of_vehicles"] ?? "?"} vehicles: ${vehicles.map((v) => optionLabel(groups, "vehicles", v) ?? v).join(", ")}` : "Not given"],
    ["Driver ages", values["driver_ages"] || "Not given"],
    ["Left blank", result.left_blank.join(", ") || "None"],
  ];

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(reportSummary({ ...props }));
      setCopied("Copied");
    } catch {
      setCopied("Copy failed. Select the report text and copy it instead.");
    }
  }

  return (
    <Frame>
      <div style={{ padding: "22px 26px" }}>
        <div className={`${styles.reportToolbar} no-print`}>
          <div>
            <h2 className={ui.cardTitle}>Assessment report</h2>
            <p className={ui.muted} style={{ margin: 0 }}>
              A one-page record of this estimate, to print or save with the case file.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className={ui.btnSecondary} onClick={() => { window.print(); }}>
              Print report
            </button>
            <button type="button" className={ui.btnSecondary} onClick={() => { window.print(); }}>
              Save as PDF
            </button>
            <button type="button" className={ui.btnSecondary} onClick={() => void copySummary()}>
              Copy summary
            </button>
            <span role="status" aria-live="polite" className={ui.muted}>
              {copied}
            </span>
          </div>
        </div>

        <div className={styles.tray}>
          <article className={`${styles.paper} report-paper`}>
            <header className={styles.paperHead}>
              <div>
                <div className={ui.muted} style={{ fontWeight: 700 }}>
                  Road safety estimator
                </div>
                <h3 style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 36, margin: 0 }}>
                  Collision severity assessment
                </h3>
              </div>
              <div style={{ textAlign: "right", fontSize: 14 }}>
                <div>Generated {generated}</div>
                <div>{modelName} model</div>
              </div>
            </header>

            <section className="report-section">
              <h4 className={styles.reportH2}>1. Result</h4>
              <div
                style={{
                  display: "inline-block",
                  background: "var(--blue)",
                  color: "#fff",
                  borderRadius: 12,
                  padding: "4px 16px",
                  fontFamily: "var(--font-head)",
                  fontWeight: 700,
                  fontSize: 40,
                }}
              >
                {result.severity}
              </div>
              <p style={{ margin: "8px 0" }}>{MEANING[result.severity] ?? ""}</p>
              <p style={{ margin: 0 }}>
                Model estimate for each class, before weighting: Slight {Math.round((result.scores["Slight"] ?? 0) * 100)}%, Serious{" "}
                {Math.round((result.scores["Serious"] ?? 0) * 100)}%, Fatal {Math.round((result.scores["Fatal"] ?? 0) * 100)}%.
              </p>
            </section>

            <section className="report-section">
              <h4 className={styles.reportH2}>2. Details entered</h4>
              <dl className={styles.dl}>
                {details.map(([term, description]) => (
                  <div key={term} style={{ display: "contents" }}>
                    <dt>{term}</dt>
                    <dd>{description}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="report-section">
              <h4 className={styles.reportH2}>3. How far to trust it</h4>
              {reliability ? <p style={{ margin: "0 0 6px" }}>{reliability}</p> : null}
              <p style={{ margin: "0 0 6px" }}>{weightingNote(result, about.model.fatal_weight)}</p>
              {result.severity === "Fatal" ? <p style={{ margin: "0 0 6px", fontWeight: 700 }}>{fatalFalseAlarmSentence(about)}</p> : null}
              {result.warnings.map((warning) => (
                <p key={warning} style={{ margin: "0 0 6px" }}>
                  {warning}
                </p>
              ))}
            </section>

            <section className="report-section">
              <h4 className={styles.reportH2}>4. Hotspots near this location</h4>
              {pin && nearby.length > 0 ? (
                <ul style={{ margin: "0 0 6px", paddingLeft: 20 }}>
                  {nearby.map((item) => (
                    <li key={item.id}>
                      {item.distance_m} m away: {item.collisions} collisions, {item.fatal} Fatal, {item.serious} Serious. {hotspotLabel(item)}.
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: "0 0 6px" }}>{pin ? "No Fatal or Serious hotspot lies within 500 m of the pin." : "Not given: no location was entered."}</p>
              )}
              <p style={{ margin: "0 0 6px", fontSize: 13, color: "var(--muted)" }}>A hotspot is a place where past collisions cluster. It is not a prediction.</p>
            </section>

            <section className="report-section">
              <h4 className={styles.reportH2}>5. Limits</h4>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {LIMIT_TEXT.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </section>

            <footer style={{ marginTop: 22, fontSize: 13, color: "var(--muted)" }}>
              Data: UK Department for Transport STATS19 road safety data, 2021 to 2025, Great Britain. Open Government Licence v3.0.
            </footer>
          </article>
        </div>
      </div>
    </Frame>
  );
}
