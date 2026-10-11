import { useEffect, useState } from "react";
import type { About, FormGroup, PredictResponse } from "../api/endpoints";
import type { NearbyOut } from "../api/hotspotContract";
import { hotspotLabel } from "../state/hotspotState";
import type { ExplainState, Pin } from "../state/assessStore";
import { MEANING, fatalLimitSentence, reliabilitySentence } from "../state/resultMath";
import { optionLabel } from "../state/labels";
import { ExplainFactors } from "./ExplainFactors";
import styles from "./result.module.css";
import { Frame } from "./Frame";
import ui from "./ui.module.css";

interface Props {
  result: PredictResponse;
  about: About;
  explain: ExplainState;
  groups: FormGroup[];
  values: Record<string, string>;
  vehicles: string[];
  pin: Pin | null;
  modelName: string;
  nearby: NearbyOut[];
}

function limitText(about: About): string[] {
  return [
    "This is an estimate for a collision that has already been reported. It is not a pre-collision risk score.",
    fatalLimitSentence(about),
    "The estimate does not replace a police or medical assessment.",
  ];
}

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

// "34, 9" -> numbers; drops anything that doesn't parse rather than showing a bare, unlabelled figure.
function formatDriverAges(raw: string | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "Not given";
  const ages = text
    .split(/[,;\s]+/)
    .filter((token) => token !== "")
    .map(Number)
    .filter((age) => Number.isFinite(age));
  if (ages.length === 0) return "Not given";
  const min = Math.min(...ages);
  const max = Math.max(...ages);
  const average = Math.round(ages.reduce((total, age) => total + age, 0) / ages.length);
  return `Min ${min}, max ${max}, average ${average}`;
}

function formatVehicleCount(values: Record<string, string>): string {
  const raw = values["number_of_vehicles"];
  if (!raw) return "vehicles";
  return `${raw} ${raw === "1" ? "vehicle" : "vehicles"}`;
}

// A local reference for a printed copy, not a server-issued id: there is no backend report-id or
// checksum endpoint, so this exists only so two printouts of the same page can be told apart.
function makeReportRef(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RSE-${stamp}-${random}`;
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
  const { result, about, explain, groups, values, vehicles, pin, modelName, nearby } = props;
  const [copied, setCopied] = useState("");
  const [reportRef] = useState(makeReportRef);
  const [generatedAt] = useState(() => new Date());
  const reliability = reliabilitySentence(about, result.severity);

  useEffect(() => {
    let saved = "";
    function setPrintTitle() {
      saved = document.title;
      document.title = `${reportRef} - Collision severity report`;
    }
    function restoreTitle() {
      document.title = saved;
    }
    window.addEventListener("beforeprint", setPrintTitle);
    window.addEventListener("afterprint", restoreTitle);
    return () => {
      window.removeEventListener("beforeprint", setPrintTitle);
      window.removeEventListener("afterprint", restoreTitle);
    };
  }, [reportRef]);

  const details: [string, string][] = [
    ["Date and time", `${formatDate(values["date"])}${values["time"] ? `, ${values["time"]}` : ""}`],
    ["Location", pin ? `${pin.name ?? "Selected point"}, ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` : "Not given"],
    ["Road", [value(groups, values, "road_type"), value(groups, values, "speed_limit"), value(groups, values, "urban_or_rural_area"), value(groups, values, "junction_detail"), value(groups, values, "first_road_class"), value(groups, values, "trunk_road_flag")].filter(Boolean).join(", ") || "Not given"],
    ["Conditions", [value(groups, values, "light_conditions"), value(groups, values, "weather_conditions"), value(groups, values, "road_surface_conditions")].filter(Boolean).join(", ") || "Not given"],
    ["Vehicles", vehicles.length > 0 ? `${formatVehicleCount(values)}: ${vehicles.map((v) => optionLabel(groups, "vehicles", v) ?? v).join(", ")}` : "Not given"],
    ["Driver ages", formatDriverAges(values["driver_ages"])],
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
    <Frame className="report-frame">
      <div className="report-shell" style={{ padding: "22px 26px" }}>
        <div className={`${styles.reportToolbar} no-print`}>
          <div>
            <h2 className={ui.cardTitle}>Assessment report</h2>
            <p className={ui.muted} style={{ margin: 0 }}>
              A one-page record of this estimate, to print or save with the case file.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" className={ui.btnSecondary} onClick={() => { window.print(); }}>
                Print / Save as PDF
              </button>
              <button type="button" className={ui.btnSecondary} onClick={() => void copySummary()}>
                Copy summary
              </button>
              <span role="status" aria-live="polite" className={ui.muted}>
                {copied}
              </span>
            </div>
            <p className={ui.muted} style={{ margin: 0, fontSize: 13 }}>
              Use your browser&rsquo;s print dialog, then choose &ldquo;Save as PDF&rdquo; as the destination.
            </p>
          </div>
        </div>

        <div className={`${styles.tray} report-tray`}>
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
                <div>Generated {generatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} at {generatedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                <div>{modelName} model</div>
              </div>
            </header>

            <section className="report-section">
              <h4 className={styles.reportH2}>1. Result</h4>
              <div
                className="severity-badge"
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
                Model estimate for each class: Slight {Math.round((result.scores["Slight"] ?? 0) * 100)}%, Serious{" "}
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
              <h4 className={styles.reportH2}>3. What pushed this estimate</h4>
              <ExplainFactors explain={explain} />
            </section>

            <section className="report-section">
              <h4 className={styles.reportH2}>4. How far to trust it</h4>
              {reliability ? <p style={{ margin: "0 0 6px" }}>{reliability}</p> : null}
              {result.warnings.map((warning) => (
                <p key={warning} style={{ margin: "0 0 6px" }}>
                  {warning}
                </p>
              ))}
            </section>

            <section className="report-section">
              <h4 className={styles.reportH2}>5. Hotspots near this location</h4>
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
              <h4 className={styles.reportH2}>6. Limits</h4>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {limitText(about).map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </section>

            <footer className="report-footer" style={{ marginTop: 22, fontSize: 13, color: "var(--muted)" }}>
              <div>
                Report ref {reportRef} &middot; Generated {generatedAt.toLocaleDateString("en-GB")}{" "}
                {generatedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} &middot; Model: {modelName || about.model.name}
              </div>
              <div style={{ marginTop: 4 }}>
                Data: {about.data.source}, {about.data.years}, Great Britain. {about.data.licence}.
              </div>
            </footer>
          </article>
        </div>
      </div>
    </Frame>
  );
}
