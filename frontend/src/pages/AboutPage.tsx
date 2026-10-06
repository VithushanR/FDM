import type { CSSProperties } from "react";
import { getAbout, type About } from "../api/endpoints";
import { useLoad } from "../api/useLoad";
import { Frame } from "../components/Frame";
import { StatusBox } from "../components/StatusBox";
import styles from "../components/ui.module.css";

// Shading by a cell's share of its row. Correct predictions are the diagonal, outlined in the blue.
function shade(share: number): CSSProperties {
  if (share >= 0.5) return { background: "#0A3F86", color: "#fff" };
  if (share >= 0.35) return { background: "#9DB8DC", color: "var(--ink)" };
  if (share >= 0.15) return { background: "#CFDCEE", color: "var(--ink)" };
  return { background: "#F1F4F8", color: "var(--ink)" };
}

const TH: CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--hairline)", fontWeight: 700 };
const TD: CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--hairline)", fontVariantNumeric: "tabular-nums" };
const SECTION: CSSProperties = { padding: "22px 26px" };

function percent(value: number | undefined): string {
  return value === undefined ? "" : `${Math.round(value * 100)}%`;
}

export function AboutPage() {
  const about = useLoad(getAbout);
  return (
    <div>
      <h1 id="page-heading" tabIndex={-1}>
        About the model
      </h1>
      {about.loading ? <StatusBox tone="muted">Loading the model information...</StatusBox> : null}
      {about.error ? (
        <StatusBox tone="error" title="The about information could not load">
          {about.error.message}
        </StatusBox>
      ) : null}
      {about.data ? <AboutContent about={about.data} /> : null}
    </div>
  );
}

function AboutContent({ about }: { about: About }) {
  const { test_results: results, data, model } = about;
  const fatal = results.per_class["Fatal"];
  const trainedOn = data.splits.train + data.splits.validation;
  const years = data.years.match(/\d{4}/g) ?? [];
  const slightShare = Math.round(data.class_share_percent["Slight"] ?? 0);
  const matrix = results.confusion_matrix_rows_true_columns_predicted;
  const testedOn = results.split.match(/\d[\d,]*/)?.[0] ?? "";

  return (
    <div style={{ display: "grid", gap: 22, marginTop: 18 }}>
      <p style={{ fontSize: 17, margin: 0 }}>
        A random forest estimates how severe a collision was, once it has been reported. On collisions it had never seen, it found about{" "}
        {Math.round((fatal?.recall ?? 0) * 10)} in 10 Fatal ones.
      </p>

      <Frame>
        <section style={SECTION} aria-labelledby="what-heading">
          <h2 id="what-heading" className={styles.cardTitle}>What the estimate is</h2>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
            <li>It reads the recorded details of a collision that has already been reported.</li>
            <li>It returns Slight, Serious or Fatal, with the model's estimate for each class.</li>
            <li>
              {`Fatal collisions are rare (${data.class_share_percent["Fatal"]}% of all collisions), so the model counts a Fatal estimate ${model.fatal_weight} times when it chooses the result. That finds more Fatal collisions and also raises false alarms.`}
            </li>
            <li>It is not a pre-collision risk score and it does not explain causes.</li>
          </ul>
        </section>
      </Frame>

      <Frame>
        <section style={SECTION} aria-labelledby="results-heading">
          <h2 id="results-heading" className={styles.cardTitle}>How well it works</h2>
          <p style={{ margin: "0 0 12px" }}>
            {`The model was tested once on ${testedOn} collisions it had never seen. Overall macro F1 was ${results.macro_f1.toFixed(4)}, balanced accuracy ${Math.round(results.balanced_accuracy * 100)}%, accuracy ${Math.round(results.accuracy * 100)}% and log loss ${results.log_loss.toFixed(3)}. Accuracy alone misleads: predicting Slight every time would score ${slightShare}%.`}
          </p>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 15, marginBottom: 14 }}>
            <caption style={{ textAlign: "left", fontWeight: 700, marginBottom: 6 }}>Results for each class</caption>
            <thead>
              <tr>
                <th scope="col" style={TH}>Class</th>
                <th scope="col" style={TH}>Share of collisions</th>
                <th scope="col" style={TH}>Found (recall)</th>
                <th scope="col" style={TH}>Right when predicted (precision)</th>
                <th scope="col" style={TH}>Collisions in test</th>
              </tr>
            </thead>
            <tbody>
              {results.classes.map((name) => {
                const row = results.per_class[name];
                return (
                  <tr key={name}>
                    <th scope="row" style={TD}>{name}</th>
                    <td style={TD}>{data.class_share_percent[name]}%</td>
                    <td style={TD}>{percent(row?.recall)}</td>
                    <td style={TD}>{percent(row?.precision)}</td>
                    <td style={TD}>{row?.support.toLocaleString("en-GB")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ margin: "0 0 14px" }}>
            {`For Fatal, that means about ${Math.round(10 * (1 - (fatal?.precision ?? 0)))} in 10 collisions the model calls Fatal are false alarms, and about ${Math.round(10 * (1 - (fatal?.recall ?? 0)))} in 10 real Fatal collisions are missed.`}
          </p>

          <table style={{ borderCollapse: "collapse", fontSize: 15 }}>
            <caption style={{ textAlign: "left", fontWeight: 700, marginBottom: 6 }}>Confusion matrix</caption>
            <thead>
              <tr>
                <td />
                {results.classes.map((name) => (
                  <th key={name} scope="col" style={TH}>
                    {`Predicted ${name}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row, rowIndex) => {
                const total = row.reduce((sum, value) => sum + value, 0);
                const rowName = results.classes[rowIndex] ?? "";
                return (
                  <tr key={rowName}>
                    <th scope="row" style={TD}>{`Really ${rowName}`}</th>
                    {row.map((count, colIndex) => {
                      const share = total === 0 ? 0 : count / total;
                      const correct = rowIndex === colIndex;
                      return (
                        <td
                          key={colIndex}
                          style={{
                            ...TD,
                            ...shade(share),
                            minWidth: 130,
                            outline: correct ? "2px solid var(--blue)" : undefined,
                            outlineOffset: correct ? -2 : undefined,
                          }}
                        >
                          {`${count.toLocaleString("en-GB")} (${Math.round(share * 100)}%)`}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={styles.muted} style={{ fontSize: 14, marginTop: 8 }}>
            Rows are what really happened. Shading shows each cell's share of its row, and the outlined cells are correct predictions.
          </p>
        </section>
      </Frame>

      <Frame>
        <section style={SECTION} aria-labelledby="limits-heading">
          <h2 id="limits-heading" className={styles.cardTitle}>What to keep in mind</h2>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
            {about.limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </section>
      </Frame>

      <Frame>
        <section style={SECTION} aria-labelledby="hotspot-heading">
          <h2 id="hotspot-heading" className={styles.cardTitle}>How hotspots are found</h2>
          <p style={{ margin: "0 0 10px" }}>
            HDBSCAN groups collisions that sit close together, and it adapts to how crowded an area is, so city junctions and country roads are both found. It runs on map coordinates in metres, in 25 km tiles with a 2 km overlap. A hotspot is a compact group where 90% of its collisions lie within 500 m of its centre.
          </p>
          <p style={{ margin: 0 }}>
            A hotspot shows where collisions clustered in the past. It does not predict a future collision, and by itself it does not show a cause.
          </p>
        </section>
      </Frame>

      <Frame>
        <section style={SECTION} aria-labelledby="data-heading">
          <h2 id="data-heading" className={styles.cardTitle}>The data</h2>
          <p style={{ margin: "0 0 10px" }}>
            {`${data.source}: ${data.collisions.toLocaleString("en-GB")} injury collisions reported in Great Britain from ${years[0] ?? ""} to ${years[1] ?? ""}. The model learned from ${trainedOn.toLocaleString("en-GB")} of them and was tested on ${data.splits.test.toLocaleString("en-GB")} it had not seen.`}
          </p>
          <p style={{ margin: 0 }}>
            Licence: {data.licence}. <a href={data.url}>Read the dataset on data.gov.uk</a>.
          </p>
        </section>
      </Frame>
    </div>
  );
}
