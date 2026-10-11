import type { ExplainState } from "../state/assessStore";
import { explainLeadSentence, explainRows, type ExplainRow } from "../state/resultMath";

// "report" matches the printed report's original, narrower layout exactly (untouched by the on-screen
// card redesign). "card" is the wider, grid-aligned layout used by the Assess page's own explain card.
type Variant = "report" | "card";

const BAR_CAP = 15; // a bar this many points or larger fills completely
const CARD_COLUMNS = "minmax(0, 1fr) 160px 108px";

function Bar({ points, variant }: { points: number; variant: Variant }) {
  const width = Math.max(8, Math.min(100, Math.round((Math.abs(points) / BAR_CAP) * 100)));
  return (
    <span
      className="explain-bar"
      style={
        variant === "card"
          ? { display: "block", width: "100%", height: 10, border: "1px solid var(--muted)", borderRadius: 5, overflow: "hidden" }
          : {
              display: "inline-block",
              width: 80,
              height: 10,
              border: "1px solid var(--muted)",
              borderRadius: 5,
              overflow: "hidden",
              verticalAlign: "middle",
              flex: "0 0 auto",
            }
      }
    >
      <span
        style={{
          display: "block",
          height: "100%",
          width: `${width}%`,
          background: points > 0 ? "var(--sev-fatal)" : "var(--blue)",
        }}
      />
    </span>
  );
}

function Row({ row, direction, variant }: { row: ExplainRow; direction: "raise" | "lower"; variant: Variant }) {
  return (
    <li
      className="explain-row"
      style={
        variant === "card"
          ? { display: "grid", gridTemplateColumns: CARD_COLUMNS, alignItems: "center", gap: 10, padding: "5px 0" }
          : { display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }
      }
    >
      <span style={variant === "report" ? { flex: "1 1 auto" } : undefined}>{row.label}</span>
      <Bar points={row.points} variant={variant} />
      <span style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap", flex: variant === "report" ? "0 0 auto" : undefined }}>
        {row.size} {direction}
      </span>
    </li>
  );
}

function List({ title, rows, direction, variant }: { title: string; rows: ExplainRow[]; direction: "raise" | "lower"; variant: Variant }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <h5 style={{ margin: "0 0 6px", fontSize: 15 }}>{title}</h5>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14 }}>Nothing you entered stood out.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((row) => (
            <Row key={`${row.label}|${row.points}`} row={row} direction={direction} variant={variant} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ExplainFactors({ explain, variant = "report" }: { explain: ExplainState; variant?: Variant }) {
  if (explain.status === "idle") return null;
  if (explain.status === "loading") {
    return (
      <p className="explain-status" style={{ margin: 0 }}>
        Working out what pushed this estimate...
      </p>
    );
  }
  if (explain.status === "error") {
    return (
      <p className="explain-status" style={{ margin: 0 }}>
        Explanation unavailable.
      </p>
    );
  }
  const { raising, lowering } = explainRows(explain.factors);
  const lead = explainLeadSentence(raising);
  return (
    <div className="explain-factors">
      {lead ? (
        <p style={{ margin: "0 0 10px" }}>{lead}</p>
      ) : null}
      <List title="Raised the chance of a more severe collision" rows={raising} direction="raise" variant={variant} />
      <List title="Lowered the chance of a more severe collision" rows={lowering} direction="lower" variant={variant} />
      <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--muted)" }}>
        These are patterns in past collision records, not proof of cause. Factors can work together.
      </p>
    </div>
  );
}
