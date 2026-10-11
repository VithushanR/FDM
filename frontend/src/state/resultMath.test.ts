import { describe, expect, it } from "vitest";
import type { About, ExplainFactor } from "../api/endpoints";
import { explainLeadSentence, explainRows, fatalLimitSentence } from "./resultMath";

const about = {
  test_results: { per_class: { Fatal: { precision: 0.0728, recall: 0.4016 } } },
} as unknown as About;

function factor(label: string, points: number): ExplainFactor {
  return { field: label, label, points };
}

describe("fatalLimitSentence", () => {
  it("states the real Fatal hit rate as a one-in-N figure, with no mention of weighting", () => {
    expect(fatalLimitSentence(about)).toBe(
      "Fatal collisions are rare, so a Fatal result is often a false alarm: in testing, about 1 in 14 Fatal results (7%) was a real fatal collision.",
    );
  });
});

describe("explainRows", () => {
  it("splits raising and lowering factors, biggest first", () => {
    const { raising, lowering } = explainRows([factor("A", 5), factor("B", 2), factor("C", -6)]);
    expect(raising.map((r) => r.label)).toEqual(["A", "B"]);
    expect(lowering.map((r) => r.label)).toEqual(["C"]);
  });

  it("drops effects under one point", () => {
    const { raising, lowering } = explainRows([factor("Tiny raise", 0.9), factor("Tiny lower", -0.4)]);
    expect(raising).toHaveLength(0);
    expect(lowering).toHaveLength(0);
  });

  it("keeps only the five biggest each way", () => {
    const many = Array.from({ length: 8 }, (_, i) => factor(`R${i}`, i + 1));
    const { raising } = explainRows(many);
    expect(raising).toHaveLength(5);
    expect(raising[0]?.label).toBe("R7");
  });

  it("sizes effects as Small, Moderate or Large by magnitude", () => {
    const { raising } = explainRows([factor("small", 2), factor("moderate", 5), factor("large", 9)]);
    expect(raising.find((r) => r.label === "small")?.size).toBe("Small");
    expect(raising.find((r) => r.label === "moderate")?.size).toBe("Moderate");
    expect(raising.find((r) => r.label === "large")?.size).toBe("Large");
  });
});

describe("explainLeadSentence", () => {
  it("is null when nothing raised the chance", () => {
    expect(explainLeadSentence([])).toBeNull();
  });

  it("names the one factor in the singular", () => {
    const { raising } = explainRows([factor("Pedal cycle involved", 10)]);
    expect(explainLeadSentence(raising)).toBe("Based on what you entered, the biggest factor was Pedal cycle involved.");
  });

  it("joins two factors with 'and'", () => {
    const { raising } = explainRows([factor("A", 10), factor("B", 5)]);
    expect(explainLeadSentence(raising)).toBe("Based on what you entered, the biggest factors were A and B.");
  });

  it("joins three or more factors with commas and a final 'and', capped at three", () => {
    const { raising } = explainRows([factor("A", 10), factor("B", 8), factor("C", 5), factor("D", 3)]);
    expect(explainLeadSentence(raising)).toBe("Based on what you entered, the biggest factors were A, B and C.");
  });
});
