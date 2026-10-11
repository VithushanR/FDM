import { useEffect, useRef } from "react";
import { getAbout, getSchema } from "../api/endpoints";
import { useLoad } from "../api/useLoad";
import { AssessForm } from "../components/AssessForm";
import { getHotspotMeta } from "../api/endpoints";
import { useNearby } from "../api/useNearby";
import { ExplainCard } from "../components/ExplainCard";
import { Frame } from "../components/Frame";
import { NearbyCard } from "../components/NearbyCard";
import { NeedsFixingSign, ResultSign } from "../components/ResultSign";
import { ReportPaper } from "../components/ReportPaper";
import { StatusBox } from "../components/StatusBox";
import { NETWORK_MESSAGE } from "../api/client";
import { useAssess } from "../state/assessStore";
import resultStyles from "../components/result.module.css";
import styles from "../components/ui.module.css";

export const bannerText = (kind: string, message: string): string =>
  kind === "unavailable" || kind === "unknown" ? `${NETWORK_MESSAGE} ${message}` : NETWORK_MESSAGE;

export function AssessPage() {
  const { state } = useAssess();
  const schema = useLoad(getSchema);
  const about = useLoad(getAbout);
  const hotspotMeta = useLoad(getHotspotMeta);
  const nearbyOn = hotspotMeta.data?.features.nearby === true;
  const nearby = useNearby(state.pin, nearbyOn);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const resultsRow = useRef<HTMLDivElement>(null);

  const result = state.result;
  useEffect(() => {
    if (!result) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultsRow.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    resultHeading.current?.focus();
  }, [result]);

  const modelName = schema.data?.model_name ?? "";

  return (
    <div>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 18 }}>
        <div>
          <h1 id="page-heading" tabIndex={-1}>
            Assess a collision
          </h1>
          <p className={styles.muted} style={{ margin: "6px 0 0", fontSize: 16 }}>
            Estimate severity for a collision that has already been reported.
          </p>
        </div>
        {modelName ? <div className={styles.muted}>Model: {modelName.toLowerCase()}</div> : null}
      </div>

      {schema.loading ? (
        <div className="no-print">
          <StatusBox tone="muted">Loading the form...</StatusBox>
        </div>
      ) : null}
      {schema.error ? (
        <div className="no-print">
          <StatusBox tone="error" title="The form could not load">
            {bannerText(schema.error.kind, schema.error.message)}
          </StatusBox>
        </div>
      ) : null}

      {schema.data ? (
        <Frame className="no-print">
          <AssessForm groups={schema.data.groups} nearby={nearby.items ?? []} />
        </Frame>
      ) : null}

      {state.submitError && state.submitError.kind !== "validation" ? (
        <div className="no-print" style={{ marginTop: 18 }}>
          <StatusBox tone="error" title="The estimate could not be made">
            {bannerText(state.submitError.kind, state.submitError.message)}
          </StatusBox>
        </div>
      ) : null}

      <div ref={resultsRow} className="results-anchor" style={{ marginTop: 24 }}>
        {result === "needs-fixing" ? (
          <div className="no-print">
            <NeedsFixingSign headingRef={resultHeading} />
          </div>
        ) : result && about.data ? (
          <>
            <div className={`no-print ${resultStyles.resultsGrid}`}>
              <ResultSign result={result} about={about.data} headingRef={resultHeading} />
              <ExplainCard explain={state.explain} />
            </div>
            {state.pin && nearbyOn ? (
              <div className="no-print" style={{ marginTop: 24 }}>
                <NearbyCard items={nearby.items} failed={nearby.failed} lat={state.pin.lat} lng={state.pin.lng} />
              </div>
            ) : null}
            <div className="report-print-anchor" style={{ marginTop: 24 }}>
              <ReportPaper
                result={result}
                about={about.data}
                explain={state.explain}
                groups={schema.data?.groups ?? []}
                values={state.values}
                vehicles={state.vehicles}
                pin={state.pin}
                modelName={modelName}
                nearby={nearby.items ?? []}
              />
            </div>
          </>
        ) : result === null && !state.submitError ? (
          <Frame className="no-print">
            <div style={{ padding: "22px 26px", color: "var(--muted)" }}>Your estimate and report will appear here.</div>
          </Frame>
        ) : null}
      </div>
      {about.error ? (
        <div className="no-print" style={{ marginTop: 18 }}>
          <StatusBox tone="warn">The about information could not load, so the result copy is not shown.</StatusBox>
        </div>
      ) : null}
    </div>
  );
}
