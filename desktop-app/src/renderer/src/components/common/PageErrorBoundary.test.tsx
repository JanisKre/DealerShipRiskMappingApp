import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PageErrorBoundary } from "./PageErrorBoundary";

const props = {
  area: "Dashboard",
  title: "Diese Seite konnte nicht angezeigt werden",
  description: "Deine Daten sind nicht betroffen.",
  retry: "Erneut versuchen",
  resetKey: "/dashboard",
  children: <p>Inhalt</p>,
};

/** The markup the boundary renders in a given state. */
function markup(state: { failed: boolean; resetKey?: string }): string {
  const boundary = new PageErrorBoundary(props);
  boundary.state = state;
  return renderToStaticMarkup(<>{boundary.render()}</>);
}

describe("PageErrorBoundary", () => {
  it("renders its children while nothing failed", () => {
    expect(markup({ failed: false, resetKey: "/dashboard" })).toBe(
      "<p>Inhalt</p>",
    );
  });

  it("switches to the message when a child throws", () => {
    expect(PageErrorBoundary.getDerivedStateFromError()).toEqual({
      failed: true,
    });
    const html = markup({ failed: true, resetKey: "/dashboard" });
    expect(html).toContain('role="alert"');
    expect(html).toContain(props.title);
    expect(html).toContain(props.description);
    expect(html).toContain(props.retry);
    expect(html).not.toContain("Inhalt");
  });

  it("clears the error when the reset key (the page) changes", () => {
    expect(
      PageErrorBoundary.getDerivedStateFromProps(
        { ...props, resetKey: "/settings" },
        { failed: true, resetKey: "/dashboard" },
      ),
    ).toEqual({ failed: false, resetKey: "/settings" });
  });

  it("keeps the error while the page stays the same", () => {
    expect(
      PageErrorBoundary.getDerivedStateFromProps(props, {
        failed: true,
        resetKey: "/dashboard",
      }),
    ).toBeNull();
  });

  it("logs the failed area", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");
    new PageErrorBoundary(props).componentDidCatch(error, {
      componentStack: "",
    });
    expect(log).toHaveBeenCalledWith(
      "Dashboard failed to render",
      error,
      expect.anything(),
    );
    log.mockRestore();
  });
});
