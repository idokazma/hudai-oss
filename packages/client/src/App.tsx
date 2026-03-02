import { Component, type ReactNode } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import { HudLayout } from './components/HudLayout.js';
import { colors } from './theme/tokens.js';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: any) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: colors.action.memory, fontFamily: 'monospace', background: colors.bg.primary, height: '100vh' }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: colors.text.primary }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: colors.text.dimmed, fontSize: 12, marginTop: 16 }}>{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 20, padding: '8px 16px', cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  useWebSocket();
  return (
    <ErrorBoundary>
      <HudLayout />
    </ErrorBoundary>
  );
}
