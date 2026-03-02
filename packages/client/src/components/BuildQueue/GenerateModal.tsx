import { useState, useEffect, useCallback, useRef } from 'react';
import { wsClient } from '../../ws/ws-client.js';
import { colors, fonts } from '../../theme/tokens.js';
import type { ServerMessage } from '@hudai/shared';

export type GenerateModalType = 'skill' | 'agent' | 'permission';

interface Props {
  type: GenerateModalType;
  onClose: () => void;
}

export function GenerateModal({ type, onClose }: Props) {
  const [step, setStep] = useState<'describe' | 'loading' | 'review'>('describe');
  const [description, setDescription] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [generatedFilename, setGeneratedFilename] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Permission-specific state
  const [permTool, setPermTool] = useState('');
  const [permType, setPermType] = useState<'allow' | 'deny'>('allow');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (step === 'describe' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [step]);

  // Listen for generate results
  useEffect(() => {
    if (type === 'permission') return;

    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      if (msg.kind === 'generate.result' && msg.type === type) {
        if (msg.success) {
          setGeneratedContent(msg.content);
          setGeneratedFilename(msg.filename);
          setStep('review');
          setError(null);
        } else {
          setError(msg.error || 'Generation failed');
          setStep('describe');
        }
      }
    });
    return () => { unsub(); };
  }, [type]);

  const handleGenerate = useCallback(() => {
    if (!description.trim()) return;
    setStep('loading');
    setError(null);
    if (type === 'skill') {
      wsClient.send({ kind: 'generate.skill', description: description.trim() });
    } else if (type === 'agent') {
      wsClient.send({ kind: 'generate.agent', description: description.trim() });
    }
  }, [description, type]);

  const handleSave = useCallback(() => {
    if (type === 'permission') {
      if (!permTool.trim()) return;
      wsClient.send({ kind: 'permission.toggle', tool: permTool.trim(), type: permType, enabled: true });
      onClose();
      return;
    }
    wsClient.send({ kind: 'generate.save', type, filename: generatedFilename, content: generatedContent });
    onClose();
  }, [type, permTool, permType, generatedFilename, generatedContent, onClose]);

  const handleRegenerate = useCallback(() => {
    setStep('loading');
    setError(null);
    if (type === 'skill') {
      wsClient.send({ kind: 'generate.skill', description: description.trim() });
    } else if (type === 'agent') {
      wsClient.send({ kind: 'generate.agent', description: description.trim() });
    }
  }, [description, type]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      if (step === 'describe' && type !== 'permission') {
        handleGenerate();
      } else if (step === 'describe' && type === 'permission') {
        handleSave();
      }
    }
  }, [step, type, handleGenerate, handleSave, onClose]);

  const title = type === 'skill' ? 'New Skill' : type === 'agent' ? 'New Agent' : 'New Permission';

  return (
    <div
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: colors.bg.overlay,
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: type === 'permission' ? 400 : 520,
        maxHeight: '80vh',
        background: colors.bg.primary,
        border: `1px solid ${colors.border.medium}`,
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${colors.border.subtle}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontSize: 13,
            fontFamily: fonts.mono,
            fontWeight: 600,
            color: colors.text.primary,
          }}>
            {title}
          </span>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'none',
              color: colors.text.muted,
              fontSize: 16,
              cursor: 'pointer',
              padding: '0 4px',
            }}
          >
            x
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
          {type === 'permission' ? (
            /* Permission: simple tool pattern input */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text.secondary }}>
                Tool pattern
              </label>
              <input
                type="text"
                value={permTool}
                onChange={(e) => setPermTool(e.target.value)}
                placeholder='e.g. Bash(pytest *), WebSearch, Bash(docker *)'
                autoFocus
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: 13,
                  fontFamily: fonts.mono,
                  background: colors.bg.secondary,
                  border: `1px solid ${colors.border.subtle}`,
                  borderRadius: 4,
                  color: colors.text.primary,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setPermType('allow')}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    fontSize: 12,
                    fontFamily: fonts.mono,
                    fontWeight: 600,
                    border: `1px solid ${permType === 'allow' ? colors.status.success : colors.border.subtle}`,
                    background: permType === 'allow' ? `${colors.status.success}20` : 'transparent',
                    color: permType === 'allow' ? colors.status.successLight : colors.text.muted,
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  Allow
                </button>
                <button
                  onClick={() => setPermType('deny')}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    fontSize: 12,
                    fontFamily: fonts.mono,
                    fontWeight: 600,
                    border: `1px solid ${permType === 'deny' ? colors.status.error : colors.border.subtle}`,
                    background: permType === 'deny' ? `${colors.status.error}20` : 'transparent',
                    color: permType === 'deny' ? colors.status.errorLight : colors.text.muted,
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  Deny
                </button>
              </div>
            </div>
          ) : step === 'describe' ? (
            /* Describe step */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text.secondary }}>
                Describe what you want the {type} to do
              </label>
              <textarea
                ref={textareaRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={type === 'skill'
                  ? 'e.g. "Always run tests before committing, use pytest with verbose output"'
                  : 'e.g. "A code reviewer that checks for security issues and suggests fixes"'
                }
                rows={4}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: 13,
                  fontFamily: fonts.mono,
                  background: colors.bg.secondary,
                  border: `1px solid ${colors.border.subtle}`,
                  borderRadius: 4,
                  color: colors.text.primary,
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  lineHeight: 1.5,
                }}
              />
              {error && (
                <div style={{ fontSize: 12, color: colors.status.errorLight, fontFamily: fonts.mono }}>
                  {error}
                </div>
              )}
            </div>
          ) : step === 'loading' ? (
            /* Loading step */
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '32px 0',
              gap: 12,
            }}>
              <div style={{
                fontSize: 13,
                fontFamily: fonts.mono,
                color: colors.text.muted,
                animation: 'pulse 1.5s ease-in-out infinite',
              }}>
                Generating {type}...
              </div>
              <style>{`@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }`}</style>
            </div>
          ) : (
            /* Review step */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <label style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text.secondary }}>
                  {generatedFilename}
                </label>
                <span style={{
                  fontSize: 10,
                  fontFamily: fonts.mono,
                  color: colors.text.muted,
                }}>
                  Edit below, then save
                </span>
              </div>
              <textarea
                value={generatedContent}
                onChange={(e) => setGeneratedContent(e.target.value)}
                rows={16}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: 12,
                  fontFamily: fonts.mono,
                  background: colors.bg.secondary,
                  border: `1px solid ${colors.border.subtle}`,
                  borderRadius: 4,
                  color: colors.text.primary,
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  lineHeight: 1.5,
                }}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 16px',
          borderTop: `1px solid ${colors.border.subtle}`,
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontFamily: fonts.mono,
              border: `1px solid ${colors.border.subtle}`,
              background: 'transparent',
              color: colors.text.muted,
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>

          {type === 'permission' ? (
            <button
              onClick={handleSave}
              disabled={!permTool.trim()}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontFamily: fonts.mono,
                fontWeight: 600,
                border: `1px solid ${colors.accent.blue}`,
                background: `${colors.accent.blue}30`,
                color: colors.accent.blueLight,
                borderRadius: 4,
                cursor: permTool.trim() ? 'pointer' : 'not-allowed',
                opacity: permTool.trim() ? 1 : 0.5,
              }}
            >
              Add
            </button>
          ) : step === 'describe' ? (
            <button
              onClick={handleGenerate}
              disabled={!description.trim()}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontFamily: fonts.mono,
                fontWeight: 600,
                border: `1px solid ${colors.accent.blue}`,
                background: `${colors.accent.blue}30`,
                color: colors.accent.blueLight,
                borderRadius: 4,
                cursor: description.trim() ? 'pointer' : 'not-allowed',
                opacity: description.trim() ? 1 : 0.5,
              }}
            >
              Generate
            </button>
          ) : step === 'review' ? (
            <>
              <button
                onClick={handleRegenerate}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontFamily: fonts.mono,
                  border: `1px solid ${colors.border.subtle}`,
                  background: 'transparent',
                  color: colors.text.secondary,
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Regenerate
              </button>
              <button
                onClick={handleSave}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontFamily: fonts.mono,
                  fontWeight: 600,
                  border: `1px solid ${colors.status.success}`,
                  background: `${colors.status.success}30`,
                  color: colors.status.successLight,
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Save
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
