import type { AxeMatchers } from "vitest-axe/matchers";

// Adds toHaveNoViolations to Vitest's expect, so the axe checks type-check. The interface has no members of its own.
declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augments Vitest's Assertion with the axe matchers
  interface Assertion extends AxeMatchers {}
}
