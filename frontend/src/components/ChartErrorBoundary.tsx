import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  hasError: boolean;
}

export default class ChartErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ChartErrorBoundary]", this.props.label ?? "chart", error, info);
  }

  render() {
    if (this.state.hasError) {
      const label = this.props.label ?? "Chart";
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <svg
            className="h-5 w-5 text-amber-500 shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">{label} unavailable</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Check your inputs and try again. If the problem persists, start a new project or reload the page.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
