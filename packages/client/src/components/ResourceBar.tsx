import { useEffect, useState, useRef, useCallback } from 'react';
import { useSessionStore, type TestHealth } from '../stores/session-store.js';
import { useEventStore } from '../stores/event-store.js';
import { useReplayStore } from '../stores/replay-store.js';
import { usePanesStore } from '../stores/panes-store.js';
import { wsClient } from '../ws/ws-client.js';
import { colors, alpha, fonts } from '../theme/tokens.js';
import { AGENT_TYPE_COLORS } from '@hudai/shared';
import { useTokenStore } from '../stores/token-store.js';
import { useGraphStore } from '../stores/graph-store.js';
import { useLibraryStore } from '../stores/library-store.js';
import { SettingsModal } from './SettingsModal.js';
import type { ServerMessage } from '@hudai/shared';

function formatElapsed(startedAt: number): string {
  if (!startedAt) return '0:00';
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

const statusColors: Record<string, string> = {
  idle: colors.text.muted,
  running: colors.accent.blue,
  paused: colors.status.warning,
  complete: colors.status.successLight,
  error: colors.status.errorLight,
};

function ResourceMeter({ label, value, color, suffix = '%' }: {
  label: string;
  value: number;
  color: string;
  suffix?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <span style={{
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: 1,
        color: colors.text.muted,
        width: 52,
        flexShrink: 0,
      }}>
        {label}
      </span>
      <div style={{
        flex: 1,
        height: 6,
        background: colors.surface.hover,
        borderRadius: 3,
        overflow: 'hidden',
        minWidth: 48,
      }}>
        <div style={{
          width: `${Math.min(100, value)}%`,
          height: '100%',
          background: color,
          borderRadius: 3,
          transition: 'width 0.6s ease',
          boxShadow: value > 80 ? `0 0 6px ${color}` : 'none',
        }} />
      </div>
      <span style={{
        fontSize: 12,
        fontFamily: fonts.mono,
        color: value > 80 ? color : colors.text.secondary,
        width: 32,
        textAlign: 'right',
        flexShrink: 0,
      }}>
        {Math.round(value)}{suffix}
      </span>
    </div>
  );
}

function TestHealthMeter({ health }: { health: TestHealth | null }) {
  if (!health) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
        <span style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 1,
          color: colors.text.muted,
          width: 52,
          flexShrink: 0,
        }}>
          Tests
        </span>
        <span style={{ fontSize: 12, color: colors.text.muted, fontFamily: fonts.mono }}>--</span>
      </div>
    );
  }

  const percent = health.total > 0 ? (health.passed / health.total) * 100 : 0;
  const color = health.failed > 0 ? colors.status.errorLight : colors.status.successLight;

  return (
    <ResourceMeter
      label="Tests"
      value={percent}
      color={color}
      suffix=""
    />
  );
}

export function ResourceBar() {
  const session = useSessionStore((s) => s.session);
  const heuristicContext = useSessionStore((s) => s.contextPercent);
  const heuristicTokens = useSessionStore((s) => s.tokensPercent);
  const testHealth = useSessionStore((s) => s.testHealth);
  const tokenState = useTokenStore((s) => s.state);
  // Use real token data when available, fall back to heuristics
  const contextPercent = tokenState ? tokenState.contextPercent : heuristicContext;
  const tokensPercent = tokenState ? Math.min(95, Math.round(tokenState.totalCost * 10)) : heuristicTokens;
  const eventCount = useEventStore((s) => s.events.length);
  const replayMode = useReplayStore((s) => s.mode);
  const exitReplay = useReplayStore((s) => s.exitReplay);
  const replayEvents = useReplayStore((s) => s.events);
  const pipelineAnalyzing = useGraphStore((s) => s.pipelineAnalyzing);
  const libraryBuilding = useLibraryStore((s) => s.isBuilding);
  const libraryProgress = useLibraryStore((s) => s.buildProgress);
  const libraryModuleCount = useLibraryStore((s) => s.moduleCount);
  const libraryFileCardCount = useLibraryStore((s) => s.fileCardCount);
  const panes = usePanesStore((s) => s.panes);
  const [elapsed, setElapsed] = useState('0:00');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keysNeedSetup, setKeysNeedSetup] = useState(false);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [serviceEnabled, setServiceEnabled] = useState({ llm: true, telegram: true, library: true });
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  const sessionDropdownRef = useRef<HTMLDivElement>(null);
  const [terminalActive, setTerminalActive] = useState(false);
  const lastPaneContentRef = useRef('');
  const terminalTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Track whether keys are missing
  useEffect(() => {
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      if (msg.kind === 'settings.keys' || msg.kind === 'settings.saved') {
        const keys = msg.keys;
        setKeysNeedSetup(!keys.geminiApiKey);
        setTelegramConnected(!!keys.telegramBotToken);
      }
      if (msg.kind === 'service.status') {
        setServiceEnabled(msg.services);
      }
    });
    return () => { unsub(); };
  }, []);

  // Track terminal activity: if pane content changes, mark active; go idle after 2s of no changes
  useEffect(() => {
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      if (msg.kind === 'pane.content' && msg.content !== lastPaneContentRef.current) {
        lastPaneContentRef.current = msg.content;
        setTerminalActive(true);
        clearTimeout(terminalTimerRef.current);
        terminalTimerRef.current = setTimeout(() => setTerminalActive(false), 2000);
      }
    });
    return () => { unsub(); clearTimeout(terminalTimerRef.current); };
  }, []);

  const isReplay = replayMode === 'replay';

  // Tick elapsed time
  useEffect(() => {
    if (!session.startedAt || session.status === 'idle') return;
    const tick = () => setElapsed(formatElapsed(session.startedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session.startedAt, session.status]);

  // Close session dropdown on outside click
  useEffect(() => {
    if (!sessionDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (sessionDropdownRef.current && !sessionDropdownRef.current.contains(e.target as Node)) {
        setSessionDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sessionDropdownOpen]);

  const openSessionDropdown = useCallback(() => {
    wsClient.send({ kind: 'panes.list' });
    setSessionDropdownOpen((v) => !v);
  }, []);

  const isAttached = session.status !== 'idle' || isReplay;

  return (
    <div style={{
      height: 64,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      background: colors.bg.gradient,
      borderBottom: `1px solid ${colors.border.subtle}`,
      gap: 16,
      overflow: 'hidden',
    }}>
      {/* Left: Logo + Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        <span style={{
          fontFamily: fonts.display,
          fontSize: 18,
          letterSpacing: 3,
          color: colors.accent.blue,
          textShadow: `0 0 12px ${colors.accent.blue}44`,
          userSelect: 'none',
        }}>
          HUDAI
        </span>
        {isReplay ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 10px',
            borderRadius: 4,
            background: `${colors.status.warning}15`,
            border: `1px solid ${colors.status.warning}30`,
          }}>
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: colors.status.warning,
            }} />
            <span style={{
              fontSize: 12,
              fontFamily: fonts.mono,
              textTransform: 'uppercase',
              letterSpacing: 1,
              color: colors.status.warning,
            }}>
              Replay
            </span>
          </div>
        ) : (
          <>
            {/* Session switcher dropdown */}
            {(() => {
              const isRunning = session.status === 'running';
              const isWorking = isRunning && terminalActive;
              const dotColor = isRunning ? colors.status.successLight : (statusColors[session.status] ?? colors.text.muted);
              const pillColor = isRunning ? colors.status.successLight : (statusColors[session.status] ?? colors.text.muted);
              return (
            <div ref={sessionDropdownRef} style={{ position: 'relative' }}>
              <button
                onClick={openSessionDropdown}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  borderRadius: 4,
                  background: `${pillColor}15`,
                  border: `1px solid ${pillColor}30`,
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <div style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: dotColor,
                  boxShadow: isRunning ? `0 0 6px ${dotColor}` : 'none',
                  animation: isWorking ? 'pulse 1.5s ease-in-out infinite' : 'none',
                }} />
                <span style={{
                  fontSize: 12,
                  fontFamily: fonts.mono,
                  letterSpacing: 0.5,
                  color: pillColor,
                }}>
                  {session.tmuxTarget || session.status}
                </span>
                <span style={{
                  fontSize: 10,
                  color: colors.text.muted,
                  marginLeft: 2,
                }}>
                  ▾
                </span>
              </button>
              {sessionDropdownOpen && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  minWidth: 220,
                  background: colors.bg.panel,
                  border: `1px solid ${colors.border.medium}`,
                  borderRadius: 6,
                  boxShadow: colors.surface.shadow,
                  zIndex: 100,
                  padding: '4px 0',
                }}>
                  {panes.map((pane) => {
                    const isCurrent = pane.id === session.tmuxTarget;
                    return (
                      <PaneRow
                        key={pane.id}
                        pane={pane}
                        isCurrent={isCurrent}
                        onAttach={() => {
                          if (!isCurrent) {
                            wsClient.send({ kind: 'session.attach', tmuxTarget: pane.id });
                          }
                          setSessionDropdownOpen(false);
                        }}
                        onKill={() => {
                          wsClient.send({ kind: 'session.kill', tmuxTarget: pane.id });
                          setSessionDropdownOpen(false);
                        }}
                      />
                    );
                  })}
                  {panes.length === 0 && (
                    <div style={{ padding: '8px 12px', fontSize: 12, color: colors.text.muted, fontFamily: fonts.mono }}>
                      No panes found
                    </div>
                  )}
                  <div style={{ height: 1, background: colors.border.subtle, margin: '4px 0' }} />
                  <button
                    onClick={() => {
                      wsClient.send({ kind: 'session.detach' });
                      setSessionDropdownOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '8px 12px',
                      border: 'none',
                      background: 'transparent',
                      color: colors.status.warning,
                      fontSize: 12,
                      fontFamily: fonts.mono,
                      cursor: 'pointer',
                      textAlign: 'left',
                      outline: 'none',
                    }}
                  >
                    Detach
                  </button>
                </div>
              )}
            </div>
              );
            })()}
            {/* LLM connection status */}
            {session.llmStatus && (() => {
              const llmPaused = !serviceEnabled.llm;
              const isThinking = !llmPaused && session.llmStatus === 'thinking';
              const llmColor = llmPaused ? colors.status.warning
                : isThinking ? colors.accent.blue
                : session.llmStatus === 'connected' ? colors.status.successLight
                : session.llmStatus === 'error' ? colors.status.errorLight
                : colors.text.muted;
              const llmLabel = llmPaused ? 'LLM'
                : session.llmActivity ? session.llmActivity
                : pipelineAnalyzing ? 'Analyzing pipelines'
                : isThinking ? 'Thinking...'
                : 'LLM';
              return (
                <button
                  onClick={() => wsClient.send({ kind: 'service.toggle', service: 'llm', enabled: !serviceEnabled.llm })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 8px',
                    borderRadius: 4,
                    background: `${llmColor}12`,
                    border: `1px solid ${llmColor}30`,
                    transition: 'all 0.3s ease',
                    cursor: 'pointer',
                    outline: 'none',
                    minWidth: 50,
                    maxWidth: 140,
                    overflow: 'hidden',
                  }}
                  title={llmPaused ? 'Click to resume LLM' : `Click to pause LLM — ${llmLabel}`}
                >
                  <div style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: llmColor,
                    boxShadow: isThinking ? `0 0 6px ${llmColor}` : `0 0 4px ${llmColor}`,
                    animation: isThinking ? 'pulse 1.5s ease-in-out infinite' : 'none',
                    flexShrink: 0,
                  }} />
                  <span style={{
                    fontSize: 11,
                    fontFamily: fonts.mono,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: llmColor,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {llmLabel}
                  </span>
                </button>
              );
            })()}
            {/* Telegram bot status */}
            {(() => {
              const tgPaused = !serviceEnabled.telegram;
              const tgColor = tgPaused ? colors.status.warning
                : telegramConnected ? colors.status.successLight
                : colors.text.muted;
              return (
                <button
                  onClick={() => wsClient.send({ kind: 'service.toggle', service: 'telegram', enabled: !serviceEnabled.telegram })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 8px',
                    borderRadius: 4,
                    background: `${tgColor}12`,
                    border: `1px solid ${tgColor}30`,
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                  title={tgPaused ? 'Click to resume Telegram' : 'Click to pause Telegram'}
                >
                  <div style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: tgColor,
                    boxShadow: tgPaused ? 'none' : telegramConnected ? `0 0 4px ${tgColor}` : 'none',
                  }} />
                  <span style={{
                    fontSize: 11,
                    fontFamily: fonts.mono,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: tgColor,
                  }}>
                    TG
                  </span>
                </button>
              );
            })()}
          </>
        )}
        {/* Library build status */}
        {isAttached && !isReplay && (libraryBuilding || libraryModuleCount > 0) && (() => {
          const libPaused = !serviceEnabled.library;
          const libColor = libPaused ? colors.status.warning
            : libraryBuilding ? colors.accent.blue
            : colors.status.successLight;
          return (
            <button
              onClick={() => wsClient.send({ kind: 'service.toggle', service: 'library', enabled: !serviceEnabled.library })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 4,
                background: `${libColor}12`,
                border: `1px solid ${libColor}30`,
                cursor: 'pointer',
                outline: 'none',
              }}
              title={libPaused ? 'Click to resume Library' : 'Click to pause Library'}
            >
              <div style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: libColor,
                boxShadow: libPaused ? 'none' : libraryBuilding ? `0 0 4px ${colors.accent.blue}` : 'none',
                animation: !libPaused && libraryBuilding ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }} />
              <span style={{
                fontSize: 11,
                fontFamily: fonts.mono,
                letterSpacing: 0.5,
                color: libColor,
              }}>
                {libPaused ? 'Library'
                  : libraryBuilding && libraryProgress
                  ? `Library ${libraryProgress.current}/${libraryProgress.total}`
                  : libraryBuilding
                  ? 'Library...'
                  : 'Library'}
              </span>
            </button>
          );
        })()}
      </div>

      {/* Breadcrumb (when sub-agents are active) */}
      {!isReplay && session.agentBreadcrumb && session.agentBreadcrumb.length > 1 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexShrink: 1,
          overflow: 'hidden',
        }}>
          {session.agentBreadcrumb.map((segment, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {i > 0 && (
                <span style={{ fontSize: 11, color: colors.text.muted }}>{'>'}</span>
              )}
              <span style={{
                fontSize: 12,
                fontFamily: fonts.mono,
                color: AGENT_TYPE_COLORS[segment] ?? colors.text.secondary,
                letterSpacing: 0.3,
              }}>
                {segment}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Center: Resource meters (only when attached) */}
      {isAttached && (
        <div style={{
          display: 'flex',
          gap: 20,
          flex: 1,
          justifyContent: 'center',
          maxWidth: 600,
          overflow: 'hidden',
          minWidth: 0,
        }}>
          {testHealth && <TestHealthMeter health={testHealth} />}
          <button
            onClick={() => wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text: 'Run the project' } } })}
            style={actionBtnStyle(colors.status.success, colors.status.successLight)}
            title="Tell the agent to run the project"
            {...actionBtnHover(colors.status.success)}
          >
            ▶ Run
          </button>
          <button
            onClick={() => wsClient.send({ kind: 'command', command: { type: 'prompt', data: { text: 'Create a PR and push it to git' } } })}
            style={actionBtnStyle(colors.accent.blue, colors.accent.blueLight)}
            title="Tell the agent to create a PR and push"
            {...actionBtnHover(colors.accent.blue)}
          >
            PR & Push
          </button>
          <button
            onClick={() => wsClient.send({ kind: 'command', command: { type: 'clear' } })}
            style={actionBtnStyle(colors.text.muted, colors.text.muted)}
            title="Send /clear to the agent"
            {...actionBtnHover(colors.text.muted)}
          >
            Clear
          </button>
        </div>
      )}

      {/* Right: Elapsed + Event count + Task label + Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {isAttached && (
          <>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              fontFamily: fonts.mono,
              color: colors.text.secondary,
            }}>
              <span style={{ color: colors.text.muted }}>{eventCount} events</span>
              <span style={{ color: colors.border.medium }}>|</span>
              <span>{elapsed}</span>
            </div>
            {/* Inline controls */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {isReplay ? (
                <button
                  onClick={exitReplay}
                  style={{
                    height: 28,
                    padding: '0 12px',
                    border: `1px solid ${colors.status.warning}50`,
                    borderRadius: 4,
                    background: `${colors.status.warning}20`,
                    color: colors.status.warning,
                    fontSize: 11,
                    fontFamily: fonts.mono,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.8,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    transition: 'all 0.2s ease',
                    outline: 'none',
                  }}
                >
                  Exit Replay
                </button>
              ) : (
                <>
                  {session.status === 'running' && (
                    <button
                      onClick={() => wsClient.send({ kind: 'command', command: { type: 'pause' } })}
                      style={{
                        height: 28,
                        padding: '0 12px',
                        border: `1px solid ${colors.status.warning}50`,
                        borderRadius: 4,
                        background: `${colors.status.warning}20`,
                        color: colors.status.warning,
                        fontSize: 11,
                        fontFamily: fonts.mono,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.8,
                        cursor: 'pointer',
                        boxShadow: `0 0 8px ${colors.status.warning}22`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        transition: 'all 0.2s ease',
                        outline: 'none',
                      }}
                    >
                      <span style={{ fontSize: 12, lineHeight: 1 }}>⏸</span> Pause
                    </button>
                  )}
                  {session.status === 'paused' && (
                    <button
                      onClick={() => wsClient.send({ kind: 'command', command: { type: 'resume' } })}
                      style={{
                        height: 28,
                        padding: '0 12px',
                        border: `1px solid ${colors.accent.blue}50`,
                        borderRadius: 4,
                        background: `${colors.accent.blue}20`,
                        color: colors.accent.blueLight,
                        fontSize: 11,
                        fontFamily: fonts.mono,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.8,
                        cursor: 'pointer',
                        boxShadow: `0 0 8px ${colors.accent.blue}22`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        transition: 'all 0.2s ease',
                        outline: 'none',
                      }}
                    >
                      <span style={{ fontSize: 12, lineHeight: 1 }}>▶</span> Resume
                    </button>
                  )}
                  <button
                    onClick={() => wsClient.reconnect()}
                    style={controlBtnStyle(colors.accent.blue)}
                    title="Refresh — reload all session data"
                    {...controlBtnHover(colors.accent.blue)}
                  >
                    Refresh
                  </button>
                  <button
                    onClick={() => setSettingsOpen(true)}
                    style={{
                      ...controlBtnStyle(colors.text.muted),
                      position: 'relative',
                      fontSize: 15,
                      padding: '0 8px',
                    }}
                    title="Settings"
                  >
                    ⚙
                    {keysNeedSetup && (
                      <div style={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: colors.status.warning,
                        boxShadow: `0 0 4px ${colors.status.warning}`,
                      }} />
                    )}
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {/* Settings gear — always visible */}
        {!isAttached && (
          <button
            onClick={() => setSettingsOpen(true)}
            style={{
              ...controlBtnStyle(colors.text.muted),
              position: 'relative',
              fontSize: 15,
              padding: '0 8px',
            }}
            title="Settings"
          >
            ⚙
            {keysNeedSetup && (
              <div style={{
                position: 'absolute',
                top: 2,
                right: 2,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: colors.status.warning,
                boxShadow: `0 0 4px ${colors.status.warning}`,
              }} />
            )}
          </button>
        )}
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function PaneRow({ pane, isCurrent, onAttach, onKill }: {
  pane: { id: string; title: string };
  isCurrent: boolean;
  onAttach: () => void;
  onKill: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        padding: '8px 12px',
        background: `${colors.status.errorLight}10`,
        borderLeft: `2px solid ${colors.status.errorLight}`,
      }}>
        <span style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.status.errorLight, flex: 1 }}>
          Kill {pane.id}?
        </span>
        <button onClick={onKill} style={{
          background: 'none', border: 'none', color: colors.status.errorLight,
          fontSize: 11, fontFamily: fonts.mono, fontWeight: 700, cursor: 'pointer', padding: '2px 6px',
        }}>Yes</button>
        <button onClick={() => setConfirming(false)} style={{
          background: 'none', border: 'none', color: colors.text.muted,
          fontSize: 11, fontFamily: fonts.mono, fontWeight: 700, cursor: 'pointer', padding: '2px 6px',
        }}>No</button>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      width: '100%',
    }}>
      <button
        onClick={onAttach}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flex: 1,
          padding: '8px 12px',
          border: 'none',
          background: isCurrent ? `${colors.accent.blue}15` : 'transparent',
          color: isCurrent ? colors.accent.blueLight : colors.text.secondary,
          fontSize: 12,
          fontFamily: fonts.mono,
          cursor: isCurrent ? 'default' : 'pointer',
          textAlign: 'left',
          outline: 'none',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => { if (!isCurrent) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
        onMouseLeave={(e) => { if (!isCurrent) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <div style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: isCurrent ? colors.accent.blue : colors.text.muted,
          flexShrink: 0,
        }} />
        <span style={{ flex: 1 }}>{pane.id}</span>
        {pane.title && pane.title !== pane.id && (
          <span style={{ fontSize: 11, color: colors.text.muted }}>{pane.title}</span>
        )}
      </button>
      {!isCurrent && (
        <button
          onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
          title="Kill session"
          style={{
            background: 'none',
            border: 'none',
            color: colors.text.muted,
            fontSize: 13,
            cursor: 'pointer',
            padding: '4px 8px',
            lineHeight: 1,
            opacity: 0.5,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = colors.status.errorLight; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = colors.text.muted; }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function controlBtnStyle(color: string): React.CSSProperties {
  return {
    height: 28,
    padding: '0 10px',
    border: `1px solid ${color}30`,
    borderRadius: 4,
    background: `${color}12`,
    color,
    fontSize: 11,
    fontFamily: fonts.mono,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    outline: 'none',
  };
}

/** Attach hover listeners to a control button ref */
function controlBtnHover(color: string) {
  return {
    onMouseEnter: (e: React.MouseEvent) => {
      (e.currentTarget as HTMLElement).style.background = `${color}25`;
      (e.currentTarget as HTMLElement).style.borderColor = `${color}55`;
    },
    onMouseLeave: (e: React.MouseEvent) => {
      (e.currentTarget as HTMLElement).style.background = `${color}12`;
      (e.currentTarget as HTMLElement).style.borderColor = `${color}30`;
    },
  };
}

function actionBtnStyle(borderColor: string, textColor: string): React.CSSProperties {
  return {
    height: 28,
    padding: '0 12px',
    border: `1px solid ${borderColor}60`,
    borderRadius: 4,
    background: `${borderColor}20`,
    color: textColor,
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.15s, border-color 0.15s',
  };
}

function actionBtnHover(color: string) {
  return {
    onMouseEnter: (e: React.MouseEvent) => {
      (e.currentTarget as HTMLElement).style.background = `${color}35`;
      (e.currentTarget as HTMLElement).style.borderColor = `${color}88`;
    },
    onMouseLeave: (e: React.MouseEvent) => {
      (e.currentTarget as HTMLElement).style.background = `${color}20`;
      (e.currentTarget as HTMLElement).style.borderColor = `${color}60`;
    },
  };
}
