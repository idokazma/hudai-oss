import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfigStore } from '../../stores/config-store.js';
import { wsClient } from '../../ws/ws-client.js';
import { colors, fonts } from '../../theme/tokens.js';
import { GenerateModal, type GenerateModalType } from './GenerateModal.js';
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

type InspectedItem =
  | { kind: 'skill'; skill: SkillFile }
  | { kind: 'agent'; agent: AgentDefinition }
  | { kind: 'preset'; tool: string; label: string; isAllowed: boolean }
  | { kind: 'permission'; permission: PermissionRule };

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

function SectionHeader({ title, count, expanded, onToggle, onAdd }: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  onAdd?: () => void;
}) {
  return (
    <div style={{
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      padding: '8px 12px',
      background: colors.surface.base,
      borderBottom: `1px solid ${colors.border.subtle}`,
    }}>
      <button
        onClick={onToggle}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: colors.text.primary,
          padding: 0,
        }}
      >
        <span style={{
          fontSize: 12,
          fontFamily: fonts.mono,
          textTransform: 'uppercase',
          letterSpacing: 1,
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
        }}>
          {count}
        </span>
      </button>
      {onAdd && (
        <div style={{ marginLeft: 6 }}>
          <AddButton onClick={onAdd} />
        </div>
      )}
    </div>
  );
}

function ItemRow({ label, detail, badge, badgeColor, onClick, onContextMenu, style: extraStyle }: {
  label: string;
  detail?: string;
  badge?: string;
  badgeColor?: string;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        padding: '5px 12px 5px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        borderBottom: `1px solid rgba(255,255,255,0.02)`,
        cursor: onClick ? 'pointer' : 'default',
        ...extraStyle,
      }}
    >
      {badge && (
        <span style={{
          fontSize: 10,
          fontFamily: fonts.mono,
          padding: '1px 4px',
          borderRadius: 3,
          background: `${badgeColor ?? colors.text.muted}22`,
          color: badgeColor ?? colors.text.muted,
          flexShrink: 0,
        }}>
          {badge}
        </span>
      )}
      <span style={{
        fontSize: 12,
        fontFamily: fonts.mono,
        color: colors.text.secondary,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {label}
      </span>
      {detail && (
        <span style={{
          fontSize: 11,
          fontFamily: fonts.mono,
          color: colors.text.muted,
          flexShrink: 0,
        }}>
          {detail}
        </span>
      )}
    </div>
  );
}

/* ── Inspect Panel ── */

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

/* ── Context Menu ── */

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
    skills: true,
    agents: true,
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
      {/* Skills */}
      <SectionHeader
        title="Skills"
        count={config.skills.length}
        expanded={expanded.skills}
        onToggle={() => toggle('skills')}
        onAdd={() => setModal('skill')}
      />
      {expanded.skills && config.skills.map((s) => {
        const canToggle = s.scope === 'project';
        const active = !s.disabled;
        return (
          <div
            key={s.path}
            onClick={() => openInspect({ kind: 'skill', skill: s })}
            onContextMenu={canToggle ? (e) => openContextMenu(e, { kind: 'skill', skill: s }) : undefined}
            style={{ cursor: 'pointer' }}
          >
            <div style={{
              padding: '5px 12px 5px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              borderBottom: '1px solid rgba(255,255,255,0.02)',
              background: active ? `${colors.status.success}10` : 'none',
            }}>
              {s.description && (
                <span style={{
                  fontSize: 10,
                  fontFamily: fonts.mono,
                  padding: '1px 4px',
                  borderRadius: 3,
                  background: `${colors.accent.blue}${active ? '22' : '10'}`,
                  color: active ? colors.accent.blue : colors.text.muted,
                  flexShrink: 0,
                }}>
                  {s.description.slice(0, 20)}
                </span>
              )}
              <span style={{
                fontSize: 12,
                fontFamily: fonts.mono,
                color: active ? colors.status.successLight : colors.text.muted,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {s.name}
              </span>
            </div>
          </div>
        );
      })}
      {expanded.skills && (() => {
        const installedNames = new Set(config.skills.map(s => s.name));
        const installable = AVAILABLE_SKILLS.filter(s => !installedNames.has(s.name));
        if (installable.length === 0) return null;
        return installable.map(s => (
          <div key={s.id} style={{
            padding: '5px 12px 5px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            borderBottom: '1px solid rgba(255,255,255,0.02)',
            opacity: 0.6,
          }}>
            <span style={{
              fontSize: 10,
              fontFamily: fonts.mono,
              padding: '1px 4px',
              borderRadius: 3,
              background: `${colors.accent.blue}22`,
              color: colors.accent.blue,
              flexShrink: 0,
            }}>
              {s.description.slice(0, 20)}
            </span>
            <span style={{
              fontSize: 12,
              fontFamily: fonts.mono,
              color: colors.text.muted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}>
              {s.name}
            </span>
            <button
              onClick={() => wsClient.send({ kind: 'skill.install', skillId: s.id })}
              title={`Install ${s.name} skill`}
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
          </div>
        ));
      })()}

      {/* Agents */}
      <SectionHeader
        title="Agents"
        count={config.agents.length}
        expanded={expanded.agents}
        onToggle={() => toggle('agents')}
        onAdd={() => setModal('agent')}
      />
      {expanded.agents && config.agents.map((a) => (
        <ItemRow
          key={a.path + a.name}
          label={a.name}
          detail={a.path === '(built-in)' ? 'built-in' : a.scope}
          badge={a.description ? a.description.slice(0, 24) : undefined}
          badgeColor={colors.action.think}
          onClick={() => openInspect({ kind: 'agent', agent: a })}
        />
      ))}

      {/* Permissions */}
      <SectionHeader
        title="Permissions"
        count={config.permissions.length}
        expanded={expanded.permissions}
        onToggle={() => toggle('permissions')}
        onAdd={() => setModal('permission')}
      />
      {expanded.permissions && (
        <>
          {/* Preset toggles */}
          {PERMISSION_PRESETS.map((preset) => {
            const isAllowed = allowedTools.has(preset.tool);
            return (
              <div
                key={preset.tool}
                onClick={() => openInspect({ kind: 'preset', tool: preset.tool, label: preset.label, isAllowed })}
                onContextMenu={(e) => openContextMenu(e, { kind: 'preset', tool: preset.tool, label: preset.label, isAllowed })}
                style={{
                  padding: '4px 12px 4px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  borderBottom: '1px solid rgba(255,255,255,0.02)',
                  background: isAllowed ? `${colors.status.success}10` : 'none',
                  cursor: 'pointer',
                }}
              >
                <span style={{
                  fontSize: 12,
                  fontFamily: fonts.mono,
                  color: isAllowed ? colors.status.successLight : colors.text.muted,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textAlign: 'left',
                }}>
                  {preset.label}
                </span>
              </div>
            );
          })}

          {/* Non-preset permissions (read-only) */}
          {nonPresetPermissions.map((p, i) => (
            <ItemRow
              key={`${p.tool}-${i}`}
              label={p.tool}
              detail={p.scope}
              badge={p.type}
              badgeColor={p.type === 'allow' ? colors.status.successLight : colors.status.errorLight}
              onClick={() => openInspect({ kind: 'permission', permission: p })}
            />
          ))}

        </>
      )}

      {/* Permission Suggestions */}
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
