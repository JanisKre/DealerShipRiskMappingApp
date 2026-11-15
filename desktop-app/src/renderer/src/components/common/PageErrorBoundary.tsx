import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@renderer/components/ui/button";
import { Card } from "@renderer/components/ui/card";

type PageErrorBoundaryProps = {
  children: ReactNode;
  /** Name of the failed area for the console, e.g. "dashboard". */
  area: string;
  title: string;
  description: string;
  retry: string;
  /**
   * The boundary clears itself when this value changes (e.g. the route
   * path), so leaving a broken page and coming back starts fresh.
   */
  resetKey?: string;
};

type PageErrorBoundaryState = { failed: boolean; resetKey?: string };

/**
 * Keeps a render error inside one page or dialog: the navigation, the
 * header and the other pages stay usable, and the message offers a retry
 * instead of an empty window.
 */
export class PageErrorBoundary extends Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  state: PageErrorBoundaryState = {
    failed: false,
    resetKey: this.props.resetKey,
  };

  static getDerivedStateFromError(): Partial<PageErrorBoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: PageErrorBoundaryProps,
    state: PageErrorBoundaryState,
  ): PageErrorBoundaryState | null {
    return props.resetKey === state.resetKey
      ? null
      : { failed: false, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`${this.props.area} failed to render`, error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.failed)
      return (
        <div className="mx-auto max-w-2xl p-8" role="alert">
          <Card className="space-y-4 p-6">
            <div>
              <h2 className="text-lg font-semibold">{this.props.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {this.props.description}
              </p>
            </div>
            <Button onClick={() => this.setState({ failed: false })}>
              {this.props.retry}
            </Button>
          </Card>
        </div>
      );
    return this.props.children;
  }
}
