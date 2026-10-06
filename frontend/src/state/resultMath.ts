import type { About, PredictResponse } from "../api/endpoints";

export const pct = (value: number): number => Math.round(value * 100);

export function weightingNote(result: PredictResponse, fatalWeight: number): string {
  const fatal = pct(result.scores["Fatal"] ?? 0);
  const adjusted = Math.round(fatal * fatalWeight);
  const rivals = (["Serious", "Slight"] as const).map((name) => ({ name, value: pct(result.scores[name] ?? 0) }));
  const top = rivals.reduce((best, item) => (item.value > best.value ? item : best));
  const relation = adjusted > top.value ? "above" : adjusted < top.value ? "below" : "level with";
  return `Fatal counts ${fatalWeight} times when the result is chosen: ${fatal}% × ${fatalWeight} = ${adjusted}%, ${relation} ${top.name} at ${top.value}%.`;
}

export function reliabilitySentence(about: About, verdict: string): string | null {
  const row = about.test_results.per_class[verdict];
  if (!row) return null;
  const precision = pct(row.precision);
  const recall = pct(row.recall);
  return `In testing, ${precision}% of collisions the model called ${verdict} really were ${verdict}, and it found ${recall}% of all real ${verdict} collisions.`;
}

export function fatalFalseAlarmSentence(about: About): string {
  const precision = about.test_results.per_class["Fatal"]?.precision ?? 0;
  return `About ${Math.round(100 - precision * 100)} in 100 collisions the model calls Fatal are false alarms, so check this estimate against the facts of the case.`;
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
