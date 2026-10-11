import type { About, ExplainFactor } from "../api/endpoints";

export const pct = (value: number): number => Math.round(value * 100);

export function reliabilitySentence(about: About, verdict: string): string | null {
  const row = about.test_results.per_class[verdict];
  if (!row) return null;
  const precision = pct(row.precision);
  const recall = pct(row.recall);
  return `In testing, ${precision}% of collisions the model called ${verdict} really were ${verdict}, and it found ${recall}% of all real ${verdict} collisions.`;
}

// The Limits-section fact about Fatal results, built from the real test precision (never the 1.5 weighting).
export function fatalLimitSentence(about: About): string {
  const precision = about.test_results.per_class["Fatal"]?.precision ?? 0;
  const percent = Math.round(precision * 100);
  const oneInN = precision > 0 ? Math.round(1 / precision) : 0;
  return `Fatal collisions are rare, so a Fatal result is often a false alarm: in testing, about 1 in ${oneInN} Fatal results (${percent}%) was a real fatal collision.`;
}

export interface ExplainRow {
  label: string;
  points: number;
  size: "Small" | "Moderate" | "Large";
}

function sizeFor(points: number): "Small" | "Moderate" | "Large" {
  const magnitude = Math.abs(points);
  if (magnitude > 8) return "Large";
  if (magnitude >= 3) return "Moderate";
  return "Small";
}

// The backend labels this "1 vehicle" / "N vehicles"; spelled out in plainer words here.
function factorLabel(factor: ExplainFactor): string {
  if (factor.field === "number_of_vehicles") {
    const match = /^(\d+) vehicles?$/.exec(factor.label);
    if (match) {
      const count = Number(match[1]);
      return count === 1 ? "Only one vehicle involved" : `${count} vehicles involved`;
    }
  }
  return factor.label;
}

// Splits the raw factors into what raised and lowered the chance of a more severe result, dropping anything
// under a point and keeping the five biggest each way, biggest first.
export function explainRows(factors: ExplainFactor[]): { raising: ExplainRow[]; lowering: ExplainRow[] } {
  const kept = factors.filter((factor) => Math.abs(factor.points) >= 1);
  const toRow = (factor: ExplainFactor): ExplainRow => ({ label: factorLabel(factor), points: factor.points, size: sizeFor(factor.points) });
  const raising = kept.filter((factor) => factor.points > 0).sort((a, b) => b.points - a.points).slice(0, 5).map(toRow);
  const lowering = kept.filter((factor) => factor.points < 0).sort((a, b) => a.points - b.points).slice(0, 5).map(toRow);
  return { raising, lowering };
}

export function explainLeadSentence(raising: ExplainRow[]): string | null {
  if (raising.length === 0) return null;
  const top = raising.slice(0, 3).map((row) => row.label);
  const phrase =
    top.length === 1 ? top[0] : top.length === 2 ? `${top[0]} and ${top[1]}` : `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]}`;
  const noun = top.length === 1 ? "factor" : "factors";
  const verb = top.length === 1 ? "was" : "were";
  return `Based on what you entered, the biggest ${noun} ${verb} ${phrase}.`;
}

export const MEANING: Record<string, string> = {
  Slight: "Minor injuries such as sprains, bruises or cuts.",
  Serious: "Injuries such as fractures, concussion or internal injuries, or a hospital stay.",
  Fatal: "At least one person died.",
};

export const SEVERITY_FILL: Record<string, string> = {
  Slight: "var(--sev-slight)",
  Serious: "var(--sev-serious)",
  Fatal: "var(--sev-fatal)",
};
