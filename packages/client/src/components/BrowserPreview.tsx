import { useState, useRef, useEffect, useCallback } from 'react';
import { usePreviewStore } from '../stores/preview-store.js';
import { wsClient } from '../ws/ws-client.js';
import { colors, fonts } from '../theme/tokens.js';

interface InspectData {
  componentName: string | null;
  selector: string;
  tag: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
}

export function BrowserPreview() {
  const url = usePreviewStore((s) => s.url);
  const proxyUrl = usePreviewStore((s) => s.proxyUrl);
  const close = usePreviewStore((s) => s.close);
  const [inspect, setInspect] = useState(false);
  const [inspectData, setInspectData] = useState<InspectData | null>(null);
  const [userMessage, setUserMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Request proxy when url is set
  useEffect(() => {
    if (!url) return;
    wsClient.send({ kind: 'preview.start', url });
    return () => {
      wsClient.send({ kind: 'preview.stop' });
    };
  }, [url]);

  // Toggle inspect mode in iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({ type: '__hudai_inspect_toggle', active: inspect }, '*');
  }, [inspect, proxyUrl]);

  // Listen for inspect messages from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === '__hudai_inspect') {
        setInspectData(e.data as InspectData);
        setUserMessage('');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Auto-focus input when popup opens
  useEffect(() => {
    if (inspectData && inputRef.current) {
      inputRef.current.focus();
    }
  }, [inspectData]);

  // Close popup on outside click
  useEffect(() => {
    if (!inspectData) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setInspectData(null);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [inspectData]);

  const handleSend = useCallback(() => {
    if (!inspectData) return;
    const instruction = userMessage.trim() || 'Help me modify it.';
    const comp = inspectData.componentName;
    const prompt = comp
      ? `In the app at ${url}, modify the <${comp}> component (${inspectData.selector}): ${instruction}`
      : `In the app at ${url}, modify the element at ${inspectData.selector} (${inspectData.tag}): ${instruction}`;

    wsClient.send({
      kind: 'command',
      command: { type: 'prompt', data: { text: prompt } },
    });
    setInspectData(null);
    setUserMessage('');
  }, [url, inspectData, userMessage]);

  const handleClose = useCallback(() => {
    wsClient.send({ kind: 'preview.stop' });
    close();
  }, [close]);

  if (!url) return null;

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 12px',
        borderBottom: `1px solid ${colors.border.subtle}`,
        background: colors.surface.dimmest,
        flexShrink: 0,
      }}>
        <span style={{
          flex: 1,
          fontSize: 12,
          fontFamily: fonts.mono,
          color: colors.text.muted,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {url}
        </span>
        <button
          onClick={() => { setInspect((v) => !v); setInspectData(null); }}
          title={inspect ? 'Exit inspect mode' : 'Inspect mode — hover to see components, right-click to ask agent'}
          style={{
            fontSize: 11,
            fontFamily: fonts.mono,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 3,
            border: inspect
              ? `1px solid ${colors.accent.blue}`
              : `1px solid ${colors.text.muted}50`,
            background: inspect ? `${colors.accent.blue}25` : 'transparent',
            color: inspect ? colors.accent.blueLight : colors.text.muted,
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          Inspect
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in browser"
          style={{
            fontSize: 13,
            color: colors.text.muted,
            textDecoration: 'none',
            cursor: 'pointer',
            lineHeight: 1,
            padding: '2px 6px',
          }}
        >
          ↗
        </a>
        <button
          onClick={handleClose}
          title="Close preview"
          style={{
            background: 'none',
            border: 'none',
            color: colors.text.muted,
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
            padding: '2px 6px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Iframe or loading state */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {proxyUrl ? (
          <iframe
            ref={iframeRef}
            src={proxyUrl}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              background: '#fff',
            }}
            onLoad={() => {
              // Re-send inspect toggle state after iframe loads
              if (inspect && iframeRef.current?.contentWindow) {
                iframeRef.current.contentWindow.postMessage(
                  { type: '__hudai_inspect_toggle', active: true },
                  '*',
                );
              }
            }}
          />
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: colors.text.muted,
            fontSize: 13,
            fontFamily: fonts.mono,
          }}>
            Starting preview...
          </div>
        )}

        {/* Inspect popup */}
        {inspectData && (
          <div
            ref={popupRef}
            style={{
              position: 'absolute',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 100,
              background: colors.bg.panel,
              border: `1px solid ${colors.accent.blue}60`,
              borderRadius: 8,
              padding: 12,
              boxShadow: `0 4px 20px rgba(0,0,0,0.6), 0 0 8px ${colors.accent.blue}20`,
              width: 380,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {/* Component info */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              background: colors.surface.dimmest,
              borderRadius: 4,
              border: `1px solid ${colors.border.subtle}`,
              flexWrap: 'wrap',
            }}>
              <span style={{
                fontSize: 12,
                fontFamily: fonts.mono,
                fontWeight: 600,
                color: colors.accent.blueLight,
              }}>
                {inspectData.componentName
                  ? `<${inspectData.componentName}>`
                  : `<${inspectData.tag}>`}
              </span>
              <span style={{
                fontSize: 11,
                fontFamily: fonts.mono,
                color: colors.text.muted,
              }}>
                {inspectData.selector}
              </span>
            </div>

            {/* Text preview */}
            {inspectData.text && (
              <div style={{
                fontSize: 11,
                fontFamily: fonts.mono,
                color: colors.text.secondary,
                padding: '2px 8px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                "{inspectData.text}"
              </div>
            )}

            {/* User instruction input */}
            <input
              ref={inputRef}
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSend();
                if (e.key === 'Escape') { setInspectData(null); setUserMessage(''); }
              }}
              placeholder="What should the agent do? (Enter to send)"
              style={{
                width: '100%',
                padding: '6px 10px',
                border: `1px solid ${colors.border.subtle}`,
                borderRadius: 4,
                background: colors.surface.dimmest,
                color: colors.text.primary,
                fontSize: 13,
                fontFamily: fonts.mono,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleSend}
              style={{
                alignSelf: 'flex-end',
                padding: '4px 14px',
                border: 'none',
                borderRadius: 4,
                background: colors.accent.blue,
                color: colors.text.white,
                fontSize: 12,
                fontFamily: fonts.mono,
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              Send to Agent
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
