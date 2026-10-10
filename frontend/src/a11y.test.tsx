import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import { renderPage } from "./test/renderPage";

// Accessibility checks on all three pages.
describe("axe checks", () => {
  it("the Assess page has no violations", async () => {
    const { container } = renderPage("/");
    await screen.findByLabelText("Date");
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("the About page has no violations", async () => {
    const { container } = renderPage("/about");
    await screen.findByText(/found about 4 in 10 Fatal ones/);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("the Hotspots page has no violations", async () => {
    const { container } = renderPage("/hotspots");
    await screen.findByText(/hotspots match your filters\./);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
