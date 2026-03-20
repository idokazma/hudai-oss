import { useRef, useEffect, useState } from 'react';
import { useSessionStore } from '../stores/session-store.js';
import { usePreviewStore } from '../stores/preview-store.js';
import { usePaneContentStore } from '../stores/pane-content-store.js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { colors, fonts } from '../theme/tokens.js';
import { CommandOverlay } from './Steering/CommandOverlay.js';

/** Stream mode terminal view — renders text blocks from agent.output messages */
function StreamTerminal() {
  const streamOutput = usePaneContentStore((s) => s.streamOutput);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const prevOutputLen = useRef(0);

  useEffect(() => {
    if (!scrollRef.current) return;
    const newLen = streamOutput?.length ?? 0;
    // Only auto-scroll if user hasn't scrolled up
    if (autoScrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevOutputLen.current = newLen;
  }, [streamOutput]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // Only re-enable auto-scroll when user is very close to bottom (within 30px)
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 30;
  };

  if (!streamOutput) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: colors.text.muted,
        fontSize: 10,
      }}>
        Waiting for agent output...
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '12px 16px',
        fontFamily: fonts.mono,
        fontSize: 10,
        lineHeight: 1.6,
        color: colors.text.primary,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {streamOutput}
    </div>
  );
}

export function PanePreview() {
  const tmuxTarget = useSessionStore((s) => s.session.tmuxTarget);
  const sessionMode = useSessionStore((s) => s.session.mode);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !tmuxTarget) return;

    // Create xterm.js terminal
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 10,
      scrollback: 5000,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: colors.terminal.bg,
        foreground: colors.terminal.fg,
        cursor: colors.terminal.cursor,
        selectionBackground: colors.terminal.selection,
        black: colors.terminal.black,
        red: colors.terminal.red,
        green: colors.terminal.green,
        yellow: colors.terminal.yellow,
        blue: colors.terminal.blue,
        magenta: colors.terminal.magenta,
        cyan: colors.terminal.cyan,
        white: colors.terminal.white,
        brightBlack: colors.terminal.brightBlack,
        brightRed: colors.terminal.brightRed,
        brightGreen: colors.terminal.brightGreen,
        brightYellow: colors.terminal.brightYellow,
        brightBlue: colors.terminal.brightBlue,
        brightMagenta: colors.terminal.brightMagenta,
        brightCyan: colors.terminal.brightCyan,
        brightWhite: colors.terminal.brightWhite,
      },
    });

    const fit = new FitAddon();
    const webLinks = new WebLinksAddon((_event, url) => {
      usePreviewStore.getState().setUrl(url);
    });
    term.loadAddon(fit);
    term.loadAddon(webLinks);
    term.open(containerRef.current);
    // Delay initial fit to ensure container has been laid out by the grid
    requestAnimationFrame(() => fit.fit());

    // Override wheel events so they always scroll the xterm.js buffer
    // instead of being forwarded as mouse reports to tmux/Claude Code
    term.attachCustomWheelEventHandler((ev) => {
      // deltaY > 0 = scroll down, deltaY < 0 = scroll up
      // Increase scroll speed for smoother navigation
      const lines = ev.deltaY > 0 ? 5 : -5;
      term.scrollLines(lines);
      return false;
    });

    termRef.current = term;
    fitRef.current = fit;

    // Connect to the raw terminal WebSocket
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws/terminal?target=${encodeURIComponent(tmuxTarget)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Fit to container and send initial size so tmux resizes to match
      fit.fit();
      const dims = fit.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
      }
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(ev.data));
      } else {
        term.write(ev.data);
      }
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    // Forward terminal input to WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // ── Terminal fit & resize ──────────────────────────────────────────
    //
    // IMPORTANT: How the terminal height model works (and what NOT to change):
    //
    // The layout is:  wrapper (flex:1, overflow:hidden)  →  container (flexShrink:0)
    //
    // - The wrapper fills the available panel height and clips overflow.
    // - The container holds xterm and does NOT shrink (flexShrink:0) — this is
    //   intentional. xterm.js renders at a fixed row count. If the container
    //   could shrink, xterm would fight the layout engine on every frame.
    // - wrapper uses `justifyContent: 'flex-end'` so the terminal pins to the
    //   bottom. When the panel is shorter than the terminal, the TOP gets clipped
    //   (not the bottom where the user's cursor is). This is the desired behavior.
    //
    // We only re-fit (recalculate rows/cols and notify tmux) on WIDTH changes.
    // Height changes intentionally just clip from the top — re-fitting height
    // would cause tmux to reflow the entire scrollback on every drag frame,
    // which is janky and loses the user's scroll position.
    //
    // If you see "too many empty lines" in the terminal, that's a tmux pane
    // size mismatch — the tmux pane has more rows than the xterm viewport.
    // The fix is to ensure the tmux pane is resized to match on initial attach
    // (see ws.onopen above), NOT to re-fit on every height change.
    // ─────────────────────────────────────────────────────────────────
    let lastWidth = containerRef.current.clientWidth;
    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      if (newWidth !== lastWidth) {
        lastWidth = newWidth;
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          const dims = fit.proposeDimensions();
          if (dims) {
            ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
          }
        }
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
      setConnected(false);
    };
  }, [tmuxTarget]);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: colors.terminal.bg,
    }}>
      {sessionMode === 'stream' ? (
        <StreamTerminal />
      ) : !tmuxTarget ? (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: colors.text.muted,
          fontSize: 10,
        }}>
          No session attached
        </div>
      ) : (
        <div
          ref={wrapperRef}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <div ref={containerRef} style={{ flexShrink: 0 }} />
        </div>
      )}
      {(tmuxTarget || sessionMode === 'stream') && <CommandOverlay />}
    </div>
  );
}
