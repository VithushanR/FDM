import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderPage } from "../test/renderPage";
import { about } from "../test/fixtures";


describe("About page", () => {
  it("takes its numbers from the fixture, not from the page", async () => {
    renderPage("/about");
    expect(await screen.findByRole("heading", { name: "About the model", level: 1 })).toBeInTheDocument();
    // Fatal recall 0.4016 gives "4 in 10"; the test set size comes from the split text.
    expect(screen.getByText(/found about 4 in 10 Fatal ones/)).toBeInTheDocument();
    expect(screen.getByText(/Overall macro F1 was 0\.4238/)).toBeInTheDocument();
    expect(screen.getByText(/tested once on 77,071 collisions/)).toBeInTheDocument();
    expect(
      screen.getByText(/The model learned from 436,730 of them and was tested on 77,071 it had not seen/),
    ).toBeInTheDocument();
  });

  it("shows the confusion matrix whose rows sum to the class supports", async () => {
    renderPage("/about");
    await screen.findByText(/found about 4 in 10 Fatal ones/);
    const matrix = document.querySelectorAll("table")[1] as HTMLTableElement;
    const rows = Array.from(matrix.querySelectorAll("tbody tr"));
    const classes = about.test_results.classes;
    rows.forEach((row, rowIndex) => {
      const cells = within(row as HTMLElement).getAllByRole("cell");
      const counts = cells.map((cell) => Number((/^([\d,]+) \(/.exec(cell.textContent ?? "")?.[1] ?? "0").replaceAll(",", "")));
      const className = classes[rowIndex];
      if (!className) throw new Error(`no class for row ${rowIndex}`);
      const row_ = about.test_results.per_class[className];
      if (!row_) throw new Error(`no per-class figures for ${className}`);
      expect(counts.reduce((sum, value) => sum + value, 0)).toBe(row_.support);
    });
  });

  it("marks the correct predictions on the diagonal", async () => {
    renderPage("/about");
    await screen.findByText(/found about 4 in 10 Fatal ones/);
    const diagonal = screen.getByRole("cell", { name: "455 (40%)" });
    expect(diagonal.style.outline).not.toBe("");
    const offDiagonal = screen.getByRole("cell", { name: "438 (39%)" });
    expect(offDiagonal.style.outline).toBe("");
  });

  it("shows the limits from the API", async () => {
    renderPage("/about");
    for (const limit of about.limits) {
      expect(await screen.findByText(limit)).toBeInTheDocument();
    }
  });
});
