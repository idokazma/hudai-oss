import { useEffect, useCallback, useState } from 'react';
import { useConfigPanelStore } from '../../stores/config-panel-store.js';
import { useConfigStore } from '../../stores/config-store.js';
import { wsClient } from '../../ws/ws-client.js';
import { colors, alpha, fonts } from '../../theme/tokens.js';
import { getAgentIcon } from '../shared/agent-icons.js';
import type { AgentDefinition } from '@hudai/shared';

function spawnAgentPrompt(agent: AgentDefinition): string {
  const subagentType = agent.rolePrompt ? 'general-purpose' : agent.name;
  const roleInstr = agent.rolePrompt ? `\nSubagent role: ${agent.rolePrompt}\n` : '';
  return `Use a subagent (Task tool, subagent_type="${subagentType}") to work on this project.\n\n${agent.description ? `Agent purpose: ${agent.description}\n` : ''}${roleInstr}The subagent should: 1) Read CLAUDE.md and understand the project structure, 2) Explore the codebase to build context, 3) Identify areas relevant to its purpose and report findings or take action.`;
}

const PERMISSION_PRESETS: Array<{ tool: string; label: string; icon: string }> = [
  { tool: 'Bash(npm *)', label: 'npm', icon: '📦' },
  { tool: 'Bash(npx *)', label: 'npx', icon: '📦' },
  { tool: 'Bash(node *)', label: 'node', icon: '🟢' },
  { tool: 'Bash(git *)', label: 'git', icon: '🔀' },
  { tool: 'Bash(gh *)', label: 'gh', icon: '🐙' },
  { tool: 'Bash(ls *)', label: 'ls', icon: '📂' },
  { tool: 'Bash(mkdir *)', label: 'mkdir', icon: '📁' },
  { tool: 'Bash(curl *)', label: 'curl', icon: '🌐' },
  { tool: 'WebSearch', label: 'WebSearch', icon: '🔍' },
  { tool: 'Bash(docker *)', label: 'docker', icon: '🐳' },
];

export function ConfigSlideOver() {
  const open = useConfigPanelStore((s) => s.open);
  const close = useConfigPanelStore((s) => s.close);
  const config = useConfigStore((s) => s.config);
  const suggestions = useConfigStore((s) => s.suggestions);
  const dismissSuggestion = useConfigStore((s) => s.dismissSuggestion);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open]);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  }, [close]);

  useEffect(() => {
    if (open) {
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  }, [open, handleEscape]);

  if (!open) return null;

  const allowedTools = new Set(
    config?.permissions
      .filter((p) => p.type === 'allow')
      .map((p) => p.tool) ?? []
  );

  const handlePresetToggle = (tool: string, currentlyAllowed: boolean) => {
    wsClient.send({ kind: 'permission.toggle', tool, type: 'allow', enabled: !currentlyAllowed });
  };

  const handleApproveSuggestion = (tool: string) => {
    wsClient.send({ kind: 'permission.toggle', tool, type: 'allow', enabled: true });
    dismissSuggestion(tool);
  };

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: visible ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0)',
        backdropFilter: visible ? 'blur(4px)' : 'none',
        transition: 'background 0.25s ease, backdrop-filter 0.25s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 400,
          background: colors.bg.panelSolid,
          borderLeft: `1px solid ${colors.border.subtle}`,
          display: 'flex',
          flexDirection: 'column',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
          boxShadow: colors.surface.shadow,
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '14px 16px',
          borderBottom: `1px solid ${colors.border.subtle}`,
          flexShrink: 0,
        }}>
          <span style={{
            flex: 1,
            fontSize: 12,
            fontFamily: fonts.display,
            fontWeight: 700,
            letterSpacing: '0.12em',
            color: colors.text.primary,
            textTransform: 'uppercase',
          }}>
            Settings
          </span>
          <button
            onClick={close}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text.muted,
              fontSize: 18,
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            x
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {!config ? (
            <div style={{
              padding: '24px 16px',
              fontSize: 12,
              color: colors.text.muted,
              textAlign: 'center',
            }}>
              No config loaded. Attach to an agent to view settings.
            </div>
          ) : (
            <>
              {/* Suggestions */}
              {suggestions.length > 0 && (
                <Section icon="💡" title="Suggestions">
                  {suggestions.map((s) => (
                    <div key={s.tool} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 0',
                      borderBottom: `1px solid rgba(255,255,255,0.03)`,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12,
                          fontFamily: fonts.mono,
                          color: colors.text.primary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {s.suggestedRule}
                        </div>
                        <div style={{
                          fontSize: 10,
                          fontFamily: fonts.mono,
                          color: colors.text.muted,
                          marginTop: 2,
                        }}>
                          Prompted {s.promptCount}x
                        </div>
                      </div>
                      <button
                        onClick={() => handleApproveSuggestion(s.tool)}
                        style={{
                          padding: '3px 8px',
                          fontSize: 10,
                          fontFamily: fonts.mono,
                          fontWeight: 600,
                          borderRadius: 3,
                          border: `1px solid ${colors.status.successLight}40`,
                          background: `${colors.status.success}20`,
                          color: colors.status.successLight,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        Allow
                      </button>
                      <button
                        onClick={() => dismissSuggestion(s.tool)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: colors.text.muted,
                          fontSize: 14,
                          cursor: 'pointer',
                          padding: '0 2px',
                          flexShrink: 0,
                        }}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </Section>
              )}

              {/* Permissions */}
              <Section icon="🔒" title="Permissions">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PERMISSION_PRESETS.map((preset) => {
                    const isAllowed = allowedTools.has(preset.tool);
                    return (
                      <PermToggle
                        key={preset.tool}
                        icon={preset.icon}
                        label={preset.label}
                        active={isAllowed}
                        onClick={() => handlePresetToggle(preset.tool, isAllowed)}
                      />
                    );
                  })}
                </div>
              </Section>

              {/* Agents */}
              {config.agents.length > 0 && (
                <Section icon="🤖" title="Agents">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {config.agents.map((agent) => {
                      const ai = getAgentIcon(agent.name);
                      return (
                      <div key={agent.path + agent.name} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 8px',
                        borderRadius: 4,
                        background: colors.surface.base,
                        borderLeft: `3px solid ${ai.color}`,
                      }}>
                        <span style={{ fontSize: 16, flexShrink: 0 }}>{ai.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 12,
                            fontFamily: fonts.mono,
                            color: colors.text.primary,
                          }}>
                            {agent.name}
                          </div>
                          {agent.description && (
                            <div style={{
                              fontSize: 10,
                              fontFamily: fonts.body,
                              color: colors.text.muted,
                              marginTop: 2,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {agent.description}
                            </div>
                          )}
                        </div>
                        <SpawnButton onClick={() => {
                          wsClient.send({
                            kind: 'command',
                            command: { type: 'prompt', data: { text: spawnAgentPrompt(agent) } },
                          });
                          close();
                        }} />
                        <span style={{
                          fontSize: 9,
                          fontFamily: fonts.mono,
                          color: colors.text.dimmed,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: colors.surface.base,
                        }}>
                          {agent.scope}
                        </span>
                      </div>
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* Skills */}
              {config.skills.length > 0 && (
                <Section icon="⚡" title="Skills">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {config.skills.map((skill) => {
                      const active = !skill.disabled;
                      return (
                        <div key={skill.path} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '6px 8px',
                          borderRadius: 4,
                          background: colors.surface.base,
                        }}>
                          <span style={{ fontSize: 14, flexShrink: 0, opacity: active ? 1 : 0.4 }}>⚡</span>
                          <span style={{
                            flex: 1,
                            fontSize: 12,
                            fontFamily: fonts.mono,
                            color: active ? colors.text.primary : colors.text.muted,
                          }}>
                            {skill.name}
                          </span>
                          {skill.scope === 'project' && (
                            <ToggleSwitch
                              active={active}
                              onClick={() => {
                                wsClient.send(active
                                  ? { kind: 'skill.disable', path: skill.path }
                                  : { kind: 'skill.enable', path: skill.path }
                                );
                              }}
                            />
                          )}
                          {skill.scope !== 'project' && (
                            <span style={{
                              fontSize: 9,
                              fontFamily: fonts.mono,
                              color: colors.text.dimmed,
                              padding: '1px 5px',
                              borderRadius: 3,
                              background: colors.surface.base,
                            }}>
                              {skill.scope}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '16px 16px 12px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10,
        fontFamily: fonts.mono,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: colors.text.muted,
        marginBottom: 10,
      }}>
        <span style={{ fontSize: 13 }}>{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function PermToggle({ icon, label, active, onClick }: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 12px',
        fontSize: 11,
        fontFamily: fonts.mono,
        fontWeight: 500,
        borderRadius: 12,
        border: `1px solid ${active ? `${colors.status.successLight}40` : colors.border.subtle}`,
        background: active
          ? (hovered ? `${colors.status.success}30` : `${colors.status.success}18`)
          : (hovered ? colors.surface.hover : 'transparent'),
        color: active ? colors.status.successLight : colors.text.muted,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: 12 }}>{icon}</span>
      {label}
    </button>
  );
}

function SpawnButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Spawn subagent"
      style={{
        padding: '3px 8px',
        fontSize: 10,
        fontFamily: fonts.mono,
        fontWeight: 600,
        borderRadius: 3,
        border: `1px solid ${alpha(colors.accent.primary, 0.3)}`,
        background: alpha(colors.accent.primary, 0.12),
        color: colors.accent.light,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      Spawn
    </button>
  );
}

function ToggleSwitch({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 32,
        height: 16,
        borderRadius: 8,
        border: 'none',
        background: active ? `${colors.status.success}60` : colors.surface.dimmer,
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.15s',
        flexShrink: 0,
        padding: 0,
      }}
    >
      <div style={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        background: active ? colors.status.successLight : colors.text.dimmed,
        position: 'absolute',
        top: 2,
        left: active ? 18 : 2,
        transition: 'left 0.15s, background 0.15s',
      }} />
    </button>
  );
}
