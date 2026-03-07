import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfigStore } from '../../stores/config-store.js';
import { wsClient } from '../../ws/ws-client.js';
import { colors, fonts } from '../../theme/tokens.js';
import { GenerateModal, type GenerateModalType } from './GenerateModal.js';
import { getAgentIcon } from '../shared/agent-icons.js';
import type { SkillFile, AgentDefinition, PermissionRule } from '@hudai/shared';

/** Built-in skill templates available to install */
const AVAILABLE_SKILLS = [
  { id: 'onboarding', name: 'onboarding', description: 'Read the codebase library before exploring' },
];

/** Permission presets — common tool patterns users toggle frequently */
const PERMISSION_PRESETS: Array<{ tool: string; label: string }> = [
  { tool: 'Bash(npm *)', label: 'npm' },
  { tool: 'Bash(npx *)', label: 'npx' },
  { tool: 'Bash(node *)', label: 'node' },
  { tool: 'Bash(git *)', label: 'git' },
  { tool: 'Bash(gh *)', label: 'gh' },
  { tool: 'Bash(ls *)', label: 'ls' },
  { tool: 'Bash(mkdir *)', label: 'mkdir' },
  { tool: 'Bash(curl *)', label: 'curl' },
  { tool: 'WebSearch', label: 'WebSearch' },
  { tool: 'Bash(docker *)', label: 'docker' },
];

/** Build a prompt to spawn a subagent with general project context */
function spawnAgentPrompt(agent: AgentDefinition): string {
  const subagentType = agent.rolePrompt ? 'general-purpose' : agent.name;
  const roleInstr = agent.rolePrompt ? `\nSubagent role: ${agent.rolePrompt}\n` : '';
  return `Use a subagent (Task tool, subagent_type="${subagentType}") to work on this project.\n\n${agent.description ? `Agent purpose: ${agent.description}\n` : ''}${roleInstr}The subagent should: 1) Read CLAUDE.md and understand the project structure, 2) Explore the codebase to build context, 3) Identify areas relevant to its purpose and report findings or take action.`;
}

type InspectedItem =
  | { kind: 'skill'; skill: SkillFile }
  | { kind: 'agent'; agent: AgentDefinition }
  | { kind: 'preset'; tool: string; label: string; isAllowed: boolean }
  | { kind: 'permission'; permission: PermissionRule };

/* ── AddButton (unchanged) ── */

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title="Add new"
      style={{
        border: `1px solid ${colors.accent.blue}50`,
        background: `${colors.accent.blue}15`,
        color: colors.accent.blueLight,
        fontSize: 13,
        fontWeight: 700,
        cursor: 'pointer',
        padding: '0 6px',
        borderRadius: 3,
        lineHeight: '18px',
        flexShrink: 0,
      }}
    >
      +
    </button>
  );
}

/* ── CategoryStrip ── */

function CategoryStrip({ icon, title, count, expanded, onToggle, onAdd, children }: {
  icon: string;
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  children?: React.ReactNode; // summary indicators when collapsed
}) {
  return (
    <div style={{
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      padding: '8px 12px',
      background: colors.surface.base,
      borderBottom: `1px solid ${colors.border.subtle}`,
      gap: 8,
    }}>
      <button
        onClick={onToggle}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: colors.text.primary,
          padding: 0,
          minWidth: 0,
        }}
      >
        <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
        <span style={{
          fontSize: 12,
          fontFamily: fonts.mono,
          textTransform: 'uppercase',
          letterSpacing: 1,
          flexShrink: 0,
        }}>
          {expanded ? '▾' : '▸'} {title}
        </span>
        <span style={{
          fontSize: 11,
          fontFamily: fonts.mono,
          padding: '1px 6px',
          borderRadius: 8,
          background: count > 0 ? `${colors.accent.blue}22` : colors.surface.base,
          color: count > 0 ? colors.accent.blueLight : colors.text.muted,
          flexShrink: 0,
        }}>
          {count}
        </span>
        {/* Summary indicators when collapsed */}
        {!expanded && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            overflow: 'hidden',
            minWidth: 0,
          }}>
            {children}
          </div>
        )}
      </button>
      {onAdd && (
        <div style={{ flexShrink: 0 }}>
          <AddButton onClick={onAdd} />
        </div>
      )}
    </div>
  );
}

/* ── IconCard ── */

function IconCard({ icon, label, borderColor, onClick, onContextMenu, onSpawn }: {
  icon: string;
  label: string;
  borderColor: string;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onSpawn?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 72,
        height: 72,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        borderRadius: 6,
        border: `1px solid ${hovered ? colors.border.medium : colors.border.subtle}`,
        borderLeft: `3px solid ${borderColor}`,
        background: hovered ? colors.surface.hover : colors.surface.base,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.15s, border-color 0.15s',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
      <span style={{
        fontSize: 10,
        fontFamily: fonts.mono,
        color: colors.text.secondary,
        textAlign: 'center',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        width: '100%',
        padding: '0 4px',
      }}>
        {label}
      </span>
      {/* Spawn button — top-right corner, visible on hover */}
      {onSpawn && hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onSpawn(); }}
          title="Spawn subagent"
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            width: 18,
            height: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            lineHeight: 1,
            borderRadius: '50%',
            border: `1px solid ${colors.accent.orange}66`,
            background: `${colors.accent.orange}30`,
            color: colors.accent.orangeLight,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ▶
        </button>
      )}
    </div>
  );
}

/* ── PermPill ── */

function PermPill({ label, active, onClick, onContextMenu }: {
  label: string;
  active: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
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
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

/* ── Summary Dot ── */

function SummaryDot({ color }: { color: string }) {
  return (
    <span style={{
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
    }} />
  );
}

/* ── Inspect Panel (unchanged) ── */

function InspectPanel({ item, fileContent, fileLoading, onClose }: {
  item: InspectedItem;
  fileContent: string | null;
  fileLoading: boolean;
  onClose: () => void;
}) {
  const title = item.kind === 'skill' ? item.skill.name
    : item.kind === 'agent' ? item.agent.name
    : item.kind === 'preset' ? item.label
    : item.permission.tool;

  const scope = item.kind === 'skill' ? item.skill.scope
    : item.kind === 'agent' ? item.agent.scope
    : item.kind === 'permission' ? item.permission.scope
    : undefined;

  const path = item.kind === 'skill' ? item.skill.path
    : item.kind === 'agent' ? item.agent.path
    : undefined;

  const description = item.kind === 'skill' ? item.skill.description
    : item.kind === 'agent' ? item.agent.description
    : undefined;

  const canToggle = item.kind === 'skill' ? item.skill.scope === 'project'
    : item.kind === 'preset';

  const isActive = item.kind === 'skill' ? !item.skill.disabled
    : item.kind === 'preset' ? item.isAllowed
    : undefined;

  const handleToggle = () => {
    if (item.kind === 'skill') {
      const s = item.skill;
      const active = !s.disabled;
      wsClient.send(active
        ? { kind: 'skill.disable', path: s.path }
        : { kind: 'skill.enable', path: s.path }
      );
    } else if (item.kind === 'preset') {
      wsClient.send({ kind: 'permission.toggle', tool: item.tool, type: 'allow', enabled: !item.isAllowed });
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        background: colors.bg.panel,
        border: `1px solid ${colors.border.subtle}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 12px',
        borderBottom: `1px solid ${colors.border.subtle}`,
        gap: 8,
        flexShrink: 0,
      }}>
        <span style={{
          flex: 1,
          fontSize: 13,
          fontFamily: fonts.mono,
          fontWeight: 600,
          color: colors.text.primary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {title}
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: colors.text.muted,
            fontSize: 16,
            cursor: 'pointer',
            padding: '0 4px',
            lineHeight: 1,
          }}
        >
          x
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        {/* Meta badges */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {scope && (
            <span style={{
              fontSize: 10,
              fontFamily: fonts.mono,
              padding: '2px 6px',
              borderRadius: 3,
              background: `${colors.accent.blue}22`,
              color: colors.accent.blueLight,
            }}>
              {scope}
            </span>
          )}
          {item.kind === 'permission' && (
            <span style={{
              fontSize: 10,
              fontFamily: fonts.mono,
              padding: '2px 6px',
              borderRadius: 3,
              background: `${item.permission.type === 'allow' ? colors.status.successLight : colors.status.errorLight}22`,
              color: item.permission.type === 'allow' ? colors.status.successLight : colors.status.errorLight,
            }}>
              {item.permission.type}
            </span>
          )}
          {item.kind === 'preset' && (
            <span style={{
              fontSize: 10,
              fontFamily: fonts.mono,
              padding: '2px 6px',
              borderRadius: 3,
              background: `${colors.accent.blue}22`,
              color: colors.accent.blueLight,
            }}>
              preset
            </span>
          )}
        </div>

        {/* Path */}
        {path && path !== '(built-in)' && (
          <div style={{
            fontSize: 11,
            fontFamily: fonts.mono,
            color: colors.text.muted,
            marginBottom: 8,
            wordBreak: 'break-all',
          }}>
            {path}
          </div>
        )}
        {path === '(built-in)' && (
          <div style={{
            fontSize: 11,
            fontFamily: fonts.mono,
            color: colors.text.muted,
            marginBottom: 8,
            fontStyle: 'italic',
          }}>
            built-in
          </div>
        )}

        {/* Tool pattern for presets */}
        {item.kind === 'preset' && (
          <div style={{
            fontSize: 11,
            fontFamily: fonts.mono,
            color: colors.text.secondary,
            marginBottom: 8,
            padding: '4px 8px',
            background: colors.surface.base,
            borderRadius: 3,
          }}>
            {item.tool}
          </div>
        )}

        {/* Description */}
        {description && (
          <div style={{
            fontSize: 12,
            fontFamily: fonts.mono,
            color: colors.text.secondary,
            marginBottom: 10,
            lineHeight: 1.5,
          }}>
            {description}
          </div>
        )}

        {/* File content */}
        {(item.kind === 'skill' || item.kind === 'agent') && path && path !== '(built-in)' && (
          <div style={{ marginTop: 4 }}>
            <div style={{
              fontSize: 10,
              fontFamily: fonts.mono,
              textTransform: 'uppercase',
              letterSpacing: 1,
              color: colors.text.muted,
              marginBottom: 4,
            }}>
              File content
            </div>
            {fileLoading ? (
              <div style={{
                fontSize: 11,
                fontFamily: fonts.mono,
                color: colors.text.muted,
                padding: 8,
              }}>
                Loading...
              </div>
            ) : fileContent != null ? (
              <pre style={{
                fontSize: 11,
                fontFamily: fonts.mono,
                color: colors.text.secondary,
                background: colors.surface.dimmest,
                border: `1px solid ${colors.border.subtle}`,
                borderRadius: 3,
                padding: 8,
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 200,
                overflowY: 'auto',
              }}>
                {fileContent.split('\n').slice(0, 50).join('\n')}
                {fileContent.split('\n').length > 50 && '\n... (truncated)'}
              </pre>
            ) : (
              <div style={{
                fontSize: 11,
                fontFamily: fonts.mono,
                color: colors.text.muted,
                padding: 8,
                fontStyle: 'italic',
              }}>
                Could not load file
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions footer */}
      {canToggle && (
        <div style={{
          padding: '8px 12px',
          borderTop: `1px solid ${colors.border.subtle}`,
          flexShrink: 0,
        }}>
          <button
            onClick={handleToggle}
            style={{
              width: '100%',
              padding: '6px 0',
              fontSize: 12,
              fontFamily: fonts.mono,
              fontWeight: 600,
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              background: isActive ? `${colors.status.error}30` : `${colors.status.success}30`,
              color: isActive ? colors.status.errorLight : colors.status.successLight,
            }}
          >
            {isActive ? 'Disable' : 'Enable'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Context Menu (unchanged) ── */

function ContextMenu({ x, y, item, onClose }: {
  x: number;
  y: number;
  item: InspectedItem;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const isActive = item.kind === 'skill' ? !item.skill.disabled
    : item.kind === 'preset' ? item.isAllowed
    : false;

  const handleAction = () => {
    if (item.kind === 'skill') {
      const s = item.skill;
      wsClient.send(!s.disabled
        ? { kind: 'skill.disable', path: s.path }
        : { kind: 'skill.enable', path: s.path }
      );
    } else if (item.kind === 'preset') {
      wsClient.send({ kind: 'permission.toggle', tool: item.tool, type: 'allow', enabled: !item.isAllowed });
    }
    onClose();
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 50,
        background: colors.bg.panel,
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: 4,
        padding: '2px 0',
        minWidth: 100,
        boxShadow: colors.surface.shadowSm,
      }}
    >
      <button
        onClick={handleAction}
        style={{
          display: 'block',
          width: '100%',
          padding: '6px 12px',
          fontSize: 12,
          fontFamily: fonts.mono,
          background: 'none',
          border: 'none',
          color: isActive ? colors.status.errorLight : colors.status.successLight,
          cursor: 'pointer',
          textAlign: 'left',
        }}
        onMouseEnter={(e) => { (e.target as HTMLElement).style.background = colors.surface.hover; }}
        onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none'; }}
      >
        {isActive ? 'Disable' : 'Enable'}
      </button>
    </div>
  );
}

/* ── Main ConfigPanel ── */

export function ConfigPanel() {
  const config = useConfigStore((s) => s.config);
  const suggestions = useConfigStore((s) => s.suggestions);
  const dismissSuggestion = useConfigStore((s) => s.dismissSuggestion);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    skills: false,
    agents: false,
    permissions: false,
  });
  const [modal, setModal] = useState<GenerateModalType | null>(null);
  const [inspected, setInspected] = useState<InspectedItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: InspectedItem } | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // Load file content when inspecting a skill/agent with a real path
  useEffect(() => {
    if (!inspected) { setFileContent(null); setFileLoading(false); return; }
    const path = inspected.kind === 'skill' ? inspected.skill.path
      : inspected.kind === 'agent' ? inspected.agent.path
      : null;
    if (!path || path === '(built-in)') { setFileContent(null); setFileLoading(false); return; }

    setFileLoading(true);
    setFileContent(null);
    wsClient.send({ kind: 'file.read', path });

    const unsub = wsClient.onMessage((msg) => {
      if (msg.kind === 'file.content' && msg.path === path) {
        setFileContent(msg.error ? null : msg.content);
        setFileLoading(false);
      }
    });
    return () => { unsub(); };
  }, [inspected]);

  const openInspect = useCallback((item: InspectedItem) => {
    setInspected(item);
    setContextMenu(null);
  }, []);

  const openContextMenu = useCallback((e: React.MouseEvent, item: InspectedItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, []);

  if (!config) {
    return (
      <div style={{
        padding: '20px 12px',
        fontSize: 12,
        color: colors.text.muted,
        textAlign: 'center',
        lineHeight: 1.6,
      }}>
        No config loaded
        <br />
        <span style={{ fontSize: 11 }}>Attach to an agent to view loadout</span>
      </div>
    );
  }

  // Build a set of currently allowed permission tools for preset matching
  const allowedTools = new Set(
    config.permissions
      .filter((p) => p.type === 'allow')
      .map((p) => p.tool)
  );

  // Permissions that aren't in presets (shown as read-only rows below presets)
  const presetToolSet = new Set(PERMISSION_PRESETS.map((p) => p.tool));
  const nonPresetPermissions = config.permissions.filter((p) => !presetToolSet.has(p.tool));

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      overflowX: 'hidden',
      position: 'relative',
    }}>
      {/* ── Skills ── */}
      <CategoryStrip
        icon="⚡"
        title="Skills"
        count={config.skills.length}
        expanded={expanded.skills}
        onToggle={() => toggle('skills')}
        onAdd={() => setModal('skill')}
      >
        {config.skills.map((s) => (
          <SummaryDot key={s.path} color={!s.disabled ? colors.status.successLight : colors.text.dimmed} />
        ))}
      </CategoryStrip>
      {expanded.skills && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          padding: '10px 12px',
          borderBottom: `1px solid ${colors.border.subtle}`,
        }}>
          {config.skills.map((s) => {
            const active = !s.disabled;
            const canCtx = s.scope === 'project';
            return (
              <IconCard
                key={s.path}
                icon={active ? '⚡' : '⚡'}
                label={s.name}
                borderColor={active ? colors.status.successLight : colors.text.dimmed}
                onClick={() => openInspect({ kind: 'skill', skill: s })}
                onContextMenu={canCtx ? (e) => openContextMenu(e, { kind: 'skill', skill: s }) : undefined}
              />
            );
          })}
          {/* Installable skills */}
          {(() => {
            const installedNames = new Set(config.skills.map(s => s.name));
            return AVAILABLE_SKILLS
              .filter(s => !installedNames.has(s.name))
              .map(s => (
                <div
                  key={s.id}
                  style={{
                    width: 72,
                    height: 72,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    borderRadius: 6,
                    border: `1px dashed ${colors.border.subtle}`,
                    background: 'transparent',
                    cursor: 'pointer',
                    opacity: 0.6,
                    flexShrink: 0,
                  }}
                  onClick={() => wsClient.send({ kind: 'skill.install', skillId: s.id })}
                  title={`Install ${s.name}`}
                >
                  <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
                  <span style={{
                    fontSize: 10,
                    fontFamily: fonts.mono,
                    color: colors.text.muted,
                    textAlign: 'center',
                    padding: '0 4px',
                  }}>
                    {s.name}
                  </span>
                </div>
              ));
          })()}
        </div>
      )}

      {/* ── Agents ── */}
      <CategoryStrip
        icon="🤖"
        title="Agents"
        count={config.agents.length}
        expanded={expanded.agents}
        onToggle={() => toggle('agents')}
        onAdd={() => setModal('agent')}
      >
        {config.agents.map((a) => (
          <SummaryDot key={a.path + a.name} color={getAgentIcon(a.name).color} />
        ))}
      </CategoryStrip>
      {expanded.agents && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          padding: '10px 12px',
          borderBottom: `1px solid ${colors.border.subtle}`,
        }}>
          {config.agents.map((a) => {
            const ai = getAgentIcon(a.name);
            return (
              <IconCard
                key={a.path + a.name}
                icon={ai.icon}
                label={a.name.length > 8 ? a.name.slice(0, 7) + '…' : a.name}
                borderColor={ai.color}
                onClick={() => openInspect({ kind: 'agent', agent: a })}
                onSpawn={() => {
                  wsClient.send({
                    kind: 'command',
                    command: { type: 'prompt', data: { text: spawnAgentPrompt(a) } },
                  });
                }}
              />
            );
          })}
        </div>
      )}

      {/* ── Permissions ── */}
      <CategoryStrip
        icon="🔒"
        title="Perms"
        count={config.permissions.length}
        expanded={expanded.permissions}
        onToggle={() => toggle('permissions')}
        onAdd={() => setModal('permission')}
      >
        {PERMISSION_PRESETS.filter((p) => allowedTools.has(p.tool)).map((p) => (
          <span
            key={p.tool}
            style={{
              fontSize: 9,
              fontFamily: fonts.mono,
              padding: '1px 5px',
              borderRadius: 8,
              background: `${colors.status.success}25`,
              color: colors.status.successLight,
              flexShrink: 0,
              lineHeight: '14px',
            }}
          >
            {p.label}
          </span>
        ))}
      </CategoryStrip>
      {expanded.permissions && (
        <div style={{
          padding: '10px 12px',
          borderBottom: `1px solid ${colors.border.subtle}`,
        }}>
          {/* Preset pills in flex-wrap row */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginBottom: nonPresetPermissions.length > 0 ? 10 : 0,
          }}>
            {PERMISSION_PRESETS.map((preset) => {
              const isAllowed = allowedTools.has(preset.tool);
              return (
                <PermPill
                  key={preset.tool}
                  label={preset.label}
                  active={isAllowed}
                  onClick={() => openInspect({ kind: 'preset', tool: preset.tool, label: preset.label, isAllowed })}
                  onContextMenu={(e) => openContextMenu(e, { kind: 'preset', tool: preset.tool, label: preset.label, isAllowed })}
                />
              );
            })}
          </div>

          {/* Non-preset permissions (read-only small text rows) */}
          {nonPresetPermissions.length > 0 && (
            <div style={{
              borderTop: `1px solid ${colors.border.subtle}`,
              paddingTop: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            }}>
              {nonPresetPermissions.map((p, i) => (
                <div
                  key={`${p.tool}-${i}`}
                  onClick={() => openInspect({ kind: 'permission', permission: p })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '2px 4px',
                    cursor: 'pointer',
                    borderRadius: 3,
                  }}
                >
                  <span style={{
                    fontSize: 9,
                    fontFamily: fonts.mono,
                    padding: '1px 4px',
                    borderRadius: 3,
                    background: `${p.type === 'allow' ? colors.status.successLight : colors.status.errorLight}22`,
                    color: p.type === 'allow' ? colors.status.successLight : colors.status.errorLight,
                    flexShrink: 0,
                  }}>
                    {p.type}
                  </span>
                  <span style={{
                    fontSize: 11,
                    fontFamily: fonts.mono,
                    color: colors.text.secondary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {p.tool}
                  </span>
                  {p.scope && (
                    <span style={{
                      fontSize: 10,
                      fontFamily: fonts.mono,
                      color: colors.text.muted,
                      flexShrink: 0,
                    }}>
                      {p.scope}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Permission Suggestions (unchanged) */}
      {suggestions.length > 0 && (
        <>
          <div style={{
            padding: '8px 12px 4px',
            fontSize: 11,
            fontFamily: fonts.mono,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: colors.status.warning,
          }}>
            Suggestions
          </div>
          {suggestions.map((s) => (
            <div key={s.tool} style={{
              padding: '6px 12px 6px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: `${colors.status.warning}08`,
              borderBottom: `1px solid rgba(255,255,255,0.02)`,
            }}>
              <span style={{
                flex: 1,
                fontSize: 11,
                fontFamily: fonts.mono,
                color: colors.text.secondary,
              }}>
                {s.suggestedRule}
                <span style={{ color: colors.text.muted }}> ({s.promptCount}x)</span>
              </span>
              <button
                onClick={() => dismissSuggestion(s.tool)}
                style={{
                  border: 'none',
                  background: 'none',
                  color: colors.text.muted,
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '0 2px',
                }}
                title="Dismiss"
              >
                x
              </button>
            </div>
          ))}
        </>
      )}

      {/* Inspect Panel overlay */}
      {inspected && (
        <InspectPanel
          item={inspected}
          fileContent={fileContent}
          fileLoading={fileLoading}
          onClose={() => setInspected(null)}
        />
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Generate Modal */}
      {modal && (
        <GenerateModal type={modal} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
