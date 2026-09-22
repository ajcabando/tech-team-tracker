import React from 'react';
import { recordError } from '../lib/diagnostics';

type State = { error: Error | null };

/**
 * Last-resort catch for render crashes. Without this, any render error unmounts
 * the entire app into an undebuggable blank screen — this fallback names the
 * failure and offers recovery instead.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    recordError('render', `${error.name}: ${error.message}`);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    const detail = `${this.state.error.name}: ${this.state.error.message}`;
    return (
      <main className="auth-screen">
        <div className="auth-card" role="alert">
          <h1>Something went wrong</h1>
          <p className="muted">The dashboard hit an unexpected error and stopped rendering.</p>
          <p className="muted" style={{ overflowWrap: 'anywhere' }}>{detail}</p>
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button
              className="primary"
              onClick={() => {
                void navigator.clipboard?.writeText(
                  `route=${window.location.hash} viewport=${window.innerWidth}x${window.innerHeight} theme=${document.documentElement.dataset.theme} ua=${window.navigator.userAgent} error=${detail}`,
                );
              }}
            >
              Copy details
            </button>
            <button className="outline" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </main>
    );
  }
}
