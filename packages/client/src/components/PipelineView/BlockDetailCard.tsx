import { useEffect, useRef, useState, useCallback } from 'react';
import type { PipelineBlock, PipelineBlockType, AgentDefinition } from '@hudai/shared';
import { useConfigStore } from '../../stores/config-store.js';
import { colors, alpha, fonts } from '../../theme/tokens.js';
import { DescriptionBullets } from './DescriptionBullets.js';

const EMPTY_AGENTS: AgentDefinition[] = [];

const BLOCK_COLORS: Record<PipelineBlockType, string> = {
  source: colors.block.source,
  transform: colors.block.transform,
  sink: colors.block.sink,
  branch: colors.block.branch,
  merge: colors.block.merge,
  'plan-step': colors.block.planStep,
};

const BLOCK_ICONS: Record<PipelineBlockType, string> = {
  source: '◉',
  transform: '⟁',
  sink: '◎',
  branch: '⑂',
  merge: '⊕',
  'plan-step': '▸',
};

function defaultBlockPrompt(block: PipelineBlock): string {
  const fileList = block.files.length > 0
    ? `\nKey files: ${block.files.slice(0, 5).join(', ')}${block.files.length > 5 ? ` (+${block.files.length - 5} more)` : ''}`
    : '';
  return `Analyze the "${block.label}" pipeline block (${block.blockType}${block.technology ? ', ' + block.technology : ''}):${fileList}\n\nWhat is its current state? Are there improvements or issues we should address? Summarize concisely.`;
}

function agentBlockPrompt(block: PipelineBlock, agent: AgentDefinition): string {
  const fileList = block.files.length > 0
    ? `Files: ${block.files.join(', ')}`
    : '';
  return `Use a subagent (Task tool, subagent_type="${agent.name}") to work on the "${block.label}" pipeline block (${block.blockType}). ${fileList}\n${agent.description ? `Agent purpose: ${agent.description}\n` : ''}The subagent should analyze all relevant files, identify issues or improvements, and report back with findings.`;
}

export const BUILTIN_AGENTS: AgentDefinition[] = [
  { name: 'Explore', path: '', scope: 'global', description: 'Fast codebase exploration' },
  { name: 'Plan', path: '', scope: 'global', description: 'Implementation planning' },
  { name: 'Bash', path: '', scope: 'global', description: 'Command execution' },
  { name: 'general-purpose', path: '', scope: 'global', description: 'Multi-step tasks' },
];

export interface BlockDetailCardProps {
  block: PipelineBlock;
  x: number;
  y: number;
  heat?: number;
  isSpotlight?: boolean;
  isFailing?: boolean;
  onClose: () => void;
  onSendPrompt: (text: string) => void;
}

export function BlockDetailCard({
  block,
  x,
  y,
  heat = 0,
  isSpotlight = false,
  isFailing = false,
  onClose,
  onSendPrompt,
}: BlockDetailCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [promptText, setPromptText] = useState('');
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const configAgents = useConfigStore((s) => s.config?.agents ?? EMPTY_AGENTS);
  const color = BLOCK_COLORS[block.blockType];
  const icon = BLOCK_ICONS[block.blockType];

  // Merge built-in agents with custom agents from config (deduplicate by name)
  const allAgents = [...BUILTIN_AGENTS, ...configAgents.filter((a) => !BUILTIN_AGENTS.some((b) => b.name === a.name))];

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    // Delay click-outside to avoid immediate close from the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClickOutside);
      clearTimeout(timer);
    };
  }, [onClose]);

  const handleSend = useCallback(() => {
    const text = promptText.trim();
    if (!text) return;
    onSendPrompt(text);
    setPromptText('');
  }, [promptText, onSendPrompt]);

  const handleAnalyze = useCallback(() => {
    onSendPrompt(defaultBlockPrompt(block));
  }, [block, onSendPrompt]);

  const handlePickAgent = useCallback((agent: AgentDefinition) => {
    onSendPrompt(agentBlockPrompt(block, agent));
    setAgentPickerOpen(false);
  }, [block, onSendPrompt]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Status indicator — plan blocks show plan-specific status
  let statusLabel = 'Idle';
  let statusColor: string = colors.text.muted;
  if (block.planStatus) {
    if (block.planStatus === 'in-progress') {
      statusLabel = 'In Progress';
      statusColor = colors.accent.primary;
    } else if (block.planStatus === 'completed') {
      statusLabel = 'Completed';
      statusColor = colors.status.successLight;
    } else {
      statusLabel = 'Planned';
      statusColor = colors.text.dimmed;
    }
  } else if (isFailing) {
    statusLabel = 'Failing';
    statusColor = colors.block.sink;
  } else if (isSpotlight) {
    statusLabel = 'Active';
    statusColor = colors.block.branch;
  } else if (heat > 0.3) {
    statusLabel = 'Hot';
    statusColor = colors.block.transform;
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 320,
        background: colors.bg.panel,
        border: `1px solid ${color}66`,
        borderRadius: 8,
        boxShadow: `0 4px 24px rgba(0,0,0,0.5), 0 0 16px ${color}20`,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: `1px solid ${color}33`,
          background: `${color}0a`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          <span style={{ fontSize: 16, color }}>{icon}</span>
          <span
            style={{
              fontSize: 13,
              fontFamily: fonts.mono,
              fontWeight: 600,
              color: colors.text.primary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {block.label}
          </span>
        </div>
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
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Type + Status row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 10,
              fontFamily: fonts.mono,
              color: `${color}cc`,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              padding: '2px 6px',
              background: `${color}15`,
              borderRadius: 3,
            }}
          >
            {block.blockType}
          </span>
          {block.technology && (
            <span
              style={{
                fontSize: 10,
                fontFamily: fonts.mono,
                color: colors.text.label,
                padding: '2px 6px',
                background: colors.surface.raised,
                borderRadius: 3,
              }}
            >
              {block.technology}
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              fontFamily: fonts.mono,
              color: statusColor,
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: statusColor,
                display: 'inline-block',
              }}
            />
            {statusLabel}
          </span>
        </div>

        {/* Description — bullet list */}
        {block.description && (
          <DescriptionBullets
            description={block.description}
            planStatus={block.planStatus}
          />
        )}

        {/* Files */}
        {block.files.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 10,
                fontFamily: fonts.mono,
                color: colors.text.muted,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 4,
              }}
            >
              Files ({block.files.length})
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                maxHeight: 140,
                overflowY: 'auto',
              }}
            >
              {block.files.map((file) => (
                <span
                  key={file}
                  style={{
                    fontSize: 11,
                    fontFamily: fonts.mono,
                    color: colors.text.label,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    padding: '1px 0',
                  }}
                  title={file}
                >
                  {file}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Heat bar */}
        {heat > 0 && (
          <div>
            <div
              style={{
                fontSize: 10,
                fontFamily: fonts.mono,
                color: colors.text.muted,
                marginBottom: 4,
              }}
            >
              Activity heat
            </div>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: colors.surface.hover,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.round(heat * 100)}%`,
                  height: '100%',
                  borderRadius: 2,
                  background: color,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Prompt input + actions */}
      <div style={{ borderTop: `1px solid ${color}22`, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          ref={inputRef}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this block..."
          style={{
            padding: '6px 8px',
            background: 'rgba(255,255,255,0.03)',
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: 4,
            color: colors.text.primary,
            fontSize: 12,
            fontFamily: fonts.mono,
            lineHeight: 1.4,
            resize: 'none',
            outline: 'none',
            minHeight: 40,
            maxHeight: 80,
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleSend}
            disabled={!promptText.trim()}
            style={{
              flex: 1,
              padding: '4px 8px',
              fontSize: 11,
              fontFamily: fonts.mono,
              fontWeight: 600,
              background: promptText.trim() ? `${colors.accent.blue}30` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${promptText.trim() ? colors.accent.blue + '55' : colors.border.subtle}`,
              borderRadius: 4,
              color: promptText.trim() ? colors.accent.blueLight : colors.text.muted,
              cursor: promptText.trim() ? 'pointer' : 'default',
            }}
          >
            Send ↵
          </button>
          <button
            onClick={handleAnalyze}
            title="Send a pre-built analysis prompt"
            style={{
              padding: '4px 8px',
              fontSize: 11,
              fontFamily: fonts.mono,
              fontWeight: 600,
              background: `${colors.accent.blue}15`,
              border: `1px solid ${colors.accent.blue}33`,
              borderRadius: 4,
              color: colors.accent.blueLight,
              cursor: 'pointer',
            }}
          >
            Analyze
          </button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setAgentPickerOpen((v) => !v)}
              title="Send a subagent to work on this block"
              style={{
                padding: '4px 8px',
                fontSize: 11,
                fontFamily: fonts.mono,
                fontWeight: 600,
                background: agentPickerOpen ? `${colors.accent.orange}30` : `${colors.accent.orange}15`,
                border: `1px solid ${agentPickerOpen ? colors.accent.orange + '66' : colors.accent.orange + '33'}`,
                borderRadius: 4,
                color: colors.accent.orangeLight,
                cursor: 'pointer',
              }}
            >
              Agent ▾
            </button>
            {agentPickerOpen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  right: 0,
                  marginBottom: 4,
                  width: 220,
                  maxHeight: 200,
                  overflowY: 'auto',
                  background: colors.bg.panel,
                  border: `1px solid ${colors.accent.orange}44`,
                  borderRadius: 6,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                  zIndex: 30,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 4,
                }}
              >
                {allAgents.map((agent) => (
                  <button
                    key={agent.name}
                    onClick={() => handlePickAgent(agent)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      padding: '6px 8px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = colors.surface.hover; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={{
                      fontSize: 12,
                      fontFamily: fonts.mono,
                      fontWeight: 600,
                      color: colors.accent.orangeLight,
                    }}>
                      {agent.name}
                    </span>
                    {agent.description && (
                      <span style={{
                        fontSize: 10,
                        fontFamily: fonts.mono,
                        color: colors.text.muted,
                        lineHeight: 1.3,
                      }}>
                        {agent.description}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
