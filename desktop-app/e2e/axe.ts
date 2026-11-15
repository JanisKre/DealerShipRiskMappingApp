import { readFileSync } from "node:fs";
import type { AxeResults, RunOptions } from "axe-core";
import type { Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// axe-core is injected through the DevTools protocol (page.evaluate), which
// the app's Content Security Policy does not block; @axe-core/playwright
// needs a second page that Electron cannot open.
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** Lets pending style changes (theme class, 0.01 ms transitions) settle. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
}

/**
 * Serious and critical WCAG 2.2 A/AA violations on the current page, one
 * readable line block per rule (empty when the page is clean).
 */
export async function seriousViolations(
  page: Page,
  context: string,
): Promise<string[]> {
  await settled(page);
  if (!(await page.evaluate(() => "axe" in window))) {
    await page.evaluate(AXE_SOURCE);
  }
  const options: RunOptions = {
    runOnly: { type: "tag", values: WCAG_TAGS },
  };
  const result = await page.evaluate(
    (opts) =>
      (
        window as unknown as {
          axe: {
            run: (context: unknown, options: unknown) => Promise<AxeResults>;
          };
        }
      ).axe.run(
        // Map tiles come from third-party servers; their markup is Leaflet's.
        { exclude: [[".leaflet-tile-pane"]] },
        opts,
      ),
    options,
  );
  return result.violations
    .map((v) =>
      // Map markers overlap where locations are close together, so their
      // free area can drop below 24 px. WCAG 2.5.8 exempts targets whose
      // function is offered by another control on the page: every location
      // is also in the list next to the map.
      v.id === "target-size"
        ? {
            ...v,
            nodes: v.nodes.filter(
              (n) => !n.html.includes("leaflet-marker-icon"),
            ),
          }
        : v,
    )
    .filter((v) => v.nodes.length > 0)
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${context}: ${v.id} (${v.impact}) – ${v.help}\n    ${v.nodes
          .slice(0, 5)
          .map(
            (n) =>
              `${n.target.join(" ")}\n      ${n.html.slice(0, 160)}\n      ${(
                n.failureSummary ?? ""
              )
                .split("\n")
                .slice(1, 2)
                .join("")
                .trim()}`,
          )
          .join("\n    ")}`,
    );
}
