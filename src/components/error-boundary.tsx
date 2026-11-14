import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Keeps a rendering error inside one part of the screen. Without it, any error unmounts the
 * whole app and the window turns white.
 */
export class ErrorBoundary extends Component<
  { fallback: (error: Error, retry: () => void) => ReactNode; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Shown in the developer tools console (right-click → Inspect), to find the cause.
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    return error ? this.props.fallback(error, () => this.setState({ error: null })) : this.props.children;
  }
}
