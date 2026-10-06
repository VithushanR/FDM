import type { RefObject } from "react";
import type { About, PredictResponse } from "../api/endpoints";
import { MEANING, SEVERITY_FILL, fatalFalseAlarmSentence, pct, reliabilitySentence, weightingNote } from "../state/resultMath";
import { StatusBox } from "./StatusBox";
import styles from "./result.module.css";

const ORDER = ["Fatal", "Serious", "Slight"] as const;
const SCALE = ["Slight", "Serious", "Fatal"] as const;

export function ResultSign({
  result,
  about,
  headingRef,
}: {
  result: PredictResponse;
  about: About;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  const verdict = result.severity;
  const reliability = reliabilitySentence(about, verdict);
  return (
    <section aria-labelledby="result-heading">
      <div className={styles.signOuter}>
        <div className={styles.signInner}>
          <div style={{ flex: "1 1 300px", minWidth: 0 }}>
            <div style={{ fontSize: 16, opacity: 0.86 }}>Estimated severity</div>
            <h2 id="result-heading" ref={headingRef} tabIndex={-1} className={styles.verdict} style={{ color: "#fff" }}>
              {verdict}
            </h2>
            <div className={styles.scale} aria-hidden="true">
              {SCALE.map((name) => (
                <div
                  key={name}
                  className={`${styles.segment} ${name === verdict ? styles.segmentActive : ""}`}
                  style={name === verdict ? { background: SEVERITY_FILL[name] } : undefined}
                >
                  {name}
                </div>
              ))}
            </div>
            <p style={{ fontSize: 17, margin: 0 }}>{MEANING[verdict]}</p>
          </div>

          <div style={{ flex: "1 1 360px", minWidth: 0 }}>
            <h3 style={{ color: "#fff", fontSize: 22 }}>Model estimate for each class, before weighting</h3>
            {ORDER.map((name) => {
              const value = pct(result.scores[name] ?? 0);
              return (
                <div className={styles.barRow} key={name}>
                  <span>{name}</span>
                  <div className={styles.bar} aria-hidden="true">
                    <div className={styles.barFill} style={{ width: `${value}%`, background: SEVERITY_FILL[name] }} />
                  </div>
                  <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{value}%</span>
                </div>
              );
            })}
            <p style={{ fontSize: 15, margin: "10px 0 6px" }}>{weightingNote(result, about.model.fatal_weight)}</p>
            {reliability ? <p style={{ fontSize: 15, margin: "0 0 6px" }}>{reliability}</p> : null}
            {verdict === "Fatal" ? (
              <p style={{ fontSize: 15, margin: "0 0 6px" }}>
                <strong>{fatalFalseAlarmSentence(about)}</strong>
              </p>
            ) : null}
            {result.warnings.map((warning) => (
              <div
                key={warning}
                role="status"
                style={{ border: "1.5px solid #F5B71F", borderRadius: 12, padding: "10px 12px", fontSize: 14, margin: "8px 0", background: "#fff", color: "var(--ink)" }}
              >
                {warning}
              </div>
            ))}
          </div>

          <div className={styles.footer}>
            {result.left_blank.length > 0 ? (
              <p style={{ margin: "0 0 6px" }}>
                Left blank: {result.left_blank.join(", ")}. The model filled these with typical values from its training data.
              </p>
            ) : null}
            <p style={{ margin: 0 }}>This is a statistical estimate. It does not replace a police or medical assessment.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function NeedsFixingSign({ headingRef }: { headingRef: RefObject<HTMLHeadingElement> }) {
  return (
    <section aria-labelledby="result-heading">
      <div className={styles.signOuter}>
        <div className={styles.signInner}>
          <div>
            <div style={{ fontSize: 16, opacity: 0.86 }}>Estimated severity</div>
            <h2 id="result-heading" ref={headingRef} tabIndex={-1} className={styles.verdict} style={{ color: "#fff", fontSize: 56 }}>
              Needs fixing
            </h2>
            <p style={{ fontSize: 17, margin: 0, maxWidth: 560 }}>
              Some answers need fixing before the model can estimate. They are marked in red in the form.
            </p>
          </div>
        </div>
      </div>
      <StatusBox tone="muted">No estimate has been made yet.</StatusBox>
    </section>
  );
}
