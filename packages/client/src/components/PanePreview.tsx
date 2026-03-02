import { useRef, useEffect, useState } from 'react';
import { useSessionStore } from '../stores/session-store.js';
import { usePreviewStore } from '../stores/preview-store.js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { colors } from '../theme/tokens.js';

export function PanePreview() {
  const tmuxTarget = useSessionStore((s) => s.session.tmuxTarget);
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
      fontSize: 13,
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
    fit.fit();

    // Override wheel events so they always scroll the xterm.js buffer
    // instead of being forwarded as mouse reports to tmux/Claude Code
    term.attachCustomWheelEventHandler((ev) => {
      const lines = ev.deltaY > 0 ? 3 : -3;
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

    // Handle resize
    let lastWidth = containerRef.current.clientWidth;
    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      // Only re-fit when width changes (e.g. sidebar resize).
      // Height changes (dragging top border) should just clip from the top.
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

    // Forward wheel events from the clipped wrapper area to xterm
    const wrapper = wrapperRef.current;
    const onWrapperWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const lines = ev.deltaY > 0 ? 3 : -3;
      term.scrollLines(lines);
    };
    wrapper?.addEventListener('wheel', onWrapperWheel, { passive: false });

    return () => {
      wrapper?.removeEventListener('wheel', onWrapperWheel);
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
      {!tmuxTarget && (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: colors.text.muted,
          fontSize: 13,
        }}>
          No session attached
        </div>
      )}
      <div
        ref={wrapperRef}
        style={{
          flex: 1,
          display: tmuxTarget ? 'flex' : 'none',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          overflow: 'hidden',
        }}
      >
        <div
          ref={containerRef}
          style={{ flexShrink: 0 }}
        />
      </div>
    </div>
  );
}
