import { useState, useEffect, useCallback } from 'react';
import { wsClient } from '../ws/ws-client.js';
import { colors, fonts } from '../theme/tokens.js';
import { useChatStore } from '../stores/chat-store.js';
import type { ServerMessage, AdvisorVerbosity, AdvisorScope } from '@hudai/shared';

type SettingsTab = 'keys' | 'advisor';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('keys');

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: colors.bg.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 700,
          maxHeight: '85vh',
          background: colors.bg.panelSolid,
          border: `1px solid ${colors.border.medium}`,
          borderRadius: 12,
          padding: '24px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{
            fontFamily: fonts.display,
            fontSize: 18,
            letterSpacing: 2,
            color: colors.text.primary,
          }}>
            SETTINGS
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text.muted,
              fontSize: 18,
              cursor: 'pointer',
              padding: '4px 8px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 20 }}>
          <TabButton label="Keys" active={activeTab === 'keys'} onClick={() => setActiveTab('keys')} />
          <TabButton label="Advisor" active={activeTab === 'advisor'} onClick={() => setActiveTab('advisor')} />
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {activeTab === 'keys' && <KeysTab />}
          {activeTab === 'advisor' && <AdvisorTab />}
        </div>
      </div>
    </div>
  );
}

/* ─── Tab button ─── */

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 20px',
        background: active ? colors.surface.hover : 'transparent',
        border: `1px solid ${active ? colors.border.medium : colors.border.subtle}`,
        borderRadius: 6,
        color: active ? colors.text.primary : colors.text.muted,
        fontSize: 13,
        fontFamily: fonts.display,
        letterSpacing: 1,
        cursor: 'pointer',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </button>
  );
}

/* ─── Keys Tab ─── */

type LLMProviderName = 'gemini' | 'openai' | 'claude';

function KeysTab() {
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [claudeKey, setClaudeKey] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [keysStatus, setKeysStatus] = useState({ geminiApiKey: false, openaiApiKey: false, claudeApiKey: false, telegramBotToken: false });
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; error?: string } | null>(null);

  // Derive active provider from which keys are set
  const activeProvider: LLMProviderName | null = keysStatus.geminiApiKey ? 'gemini'
    : keysStatus.openaiApiKey ? 'openai'
    : keysStatus.claudeApiKey ? 'claude'
    : null;

  useEffect(() => {
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      if (msg.kind === 'settings.keys') {
        setKeysStatus(msg.keys);
      } else if (msg.kind === 'settings.saved') {
        setSaving(false);
        setKeysStatus(msg.keys);
        setSaveResult({ success: msg.success, error: msg.error });
        if (msg.success) {
          setGeminiKey('');
          setOpenaiKey('');
          setClaudeKey('');
          setTelegramToken('');
        }
        setTimeout(() => setSaveResult(null), 3000);
      }
    });
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    wsClient.send({ kind: 'settings.getKeys' });
    setSaveResult(null);
  }, []);

  const hasNewKeys = geminiKey.trim() || openaiKey.trim() || claudeKey.trim() || telegramToken.trim();

  const handleSave = useCallback(() => {
    const keys: { geminiApiKey?: string; openaiApiKey?: string; claudeApiKey?: string; telegramBotToken?: string } = {};
    if (geminiKey.trim()) keys.geminiApiKey = geminiKey.trim();
    if (openaiKey.trim()) keys.openaiApiKey = openaiKey.trim();
    if (claudeKey.trim()) keys.claudeApiKey = claudeKey.trim();
    if (telegramToken.trim()) keys.telegramBotToken = telegramToken.trim();
    if (Object.keys(keys).length === 0) return;
    setSaving(true);
    wsClient.send({ kind: 'settings.saveKeys', keys });
  }, [geminiKey, openaiKey, claudeKey, telegramToken]);

  const handleClear = useCallback((key: 'geminiApiKey' | 'openaiApiKey' | 'claudeApiKey' | 'telegramBotToken') => {
    setSaving(true);
    wsClient.send({ kind: 'settings.saveKeys', keys: { [key]: '' } });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Active provider indicator */}
      <div>
        <div style={{
          fontSize: 12,
          textTransform: 'uppercase' as const,
          letterSpacing: 0.8,
          color: colors.text.secondary,
          marginBottom: 8,
        }}>
          LLM PROVIDER
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['gemini', 'openai', 'claude'] as LLMProviderName[]).map((p) => {
            const isActive = activeProvider === p;
            return (
              <div
                key={p}
                style={{
                  padding: '5px 14px',
                  background: isActive ? `${colors.accent.blue}25` : 'transparent',
                  border: `1px solid ${isActive ? colors.accent.blue : colors.border.subtle}`,
                  borderRadius: 4,
                  color: isActive ? colors.accent.blueLight : colors.text.muted,
                  fontSize: 12,
                  textTransform: 'capitalize',
                }}
              >
                {p}{isActive ? ' (active)' : ''}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: colors.text.muted, marginTop: 6 }}>
          The first configured key is auto-detected as the active provider. Set LLM_PROVIDER env var to override.
        </div>
      </div>

      <KeyField
        label="Gemini API Key"
        isSet={keysStatus.geminiApiKey}
        value={geminiKey}
        onChange={setGeminiKey}
        onClear={() => handleClear('geminiApiKey')}
        placeholder="Enter Gemini API key..."
      />
      <KeyField
        label="OpenAI API Key"
        isSet={keysStatus.openaiApiKey}
        value={openaiKey}
        onChange={setOpenaiKey}
        onClear={() => handleClear('openaiApiKey')}
        placeholder="Enter OpenAI API key..."
      />
      <KeyField
        label="Claude API Key"
        isSet={keysStatus.claudeApiKey}
        value={claudeKey}
        onChange={setClaudeKey}
        onClear={() => handleClear('claudeApiKey')}
        placeholder="Enter Anthropic API key..."
      />
      <KeyField
        label="Telegram Bot Token"
        isSet={keysStatus.telegramBotToken}
        value={telegramToken}
        onChange={setTelegramToken}
        onClear={() => handleClear('telegramBotToken')}
        placeholder="Enter Telegram bot token..."
      />

      {saveResult && (
        <div style={{
          fontSize: 12,
          fontFamily: fonts.mono,
          color: saveResult.success ? colors.status.successLight : colors.status.errorLight,
          padding: '6px 10px',
          borderRadius: 4,
          background: saveResult.success ? `${colors.status.successLight}15` : `${colors.status.errorLight}15`,
        }}>
          {saveResult.success ? 'Saved successfully' : `Error: ${saveResult.error}`}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button
          onClick={handleSave}
          disabled={saving || !hasNewKeys}
          style={{
            padding: '8px 20px',
            background: (saving || !hasNewKeys)
              ? colors.surface.hover
              : colors.accent.blue,
            border: 'none',
            borderRadius: 6,
            color: colors.text.primary,
            fontSize: 13,
            fontWeight: 600,
            cursor: (saving || !hasNewKeys) ? 'not-allowed' : 'pointer',
            opacity: (saving || !hasNewKeys) ? 0.5 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div style={{
        fontSize: 11,
        color: colors.text.muted,
        lineHeight: 1.5,
        borderTop: `1px solid ${colors.border.subtle}`,
        paddingTop: 12,
      }}>
        Keys are stored in ~/.hudai/secrets.json. Environment variables (GEMINI_API_KEY, OPENAI_API_KEY, CLAUDE_API_KEY, TELEGRAM_BOT_TOKEN) take priority over saved keys.
      </div>
    </div>
  );
}

/* ─── Advisor Tab ─── */

function AdvisorTab() {
  const [systemPrompt, setSystemPrompt] = useState('');
  const [proactivePrompt, setProactivePrompt] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [contextPreview, setContextPreview] = useState('');
  const [loadingContext, setLoadingContext] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [originalSystem, setOriginalSystem] = useState('');
  const [originalProactive, setOriginalProactive] = useState('');

  const verbosity = useChatStore((s) => s.verbosity);
  const scope = useChatStore((s) => s.scope);

  // Load prompts on mount
  useEffect(() => {
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      if (msg.kind === 'settings.advisorPrompts') {
        setSystemPrompt(msg.systemPrompt);
        setProactivePrompt(msg.proactivePrompt);
        setOriginalSystem(msg.systemPrompt);
        setOriginalProactive(msg.proactivePrompt);
        setIsCustom(msg.isCustom);
        setSaving(false);
        setDirty(false);
      } else if (msg.kind === 'settings.advisorContext') {
        setContextPreview(msg.context);
        setLoadingContext(false);
      }
    });
    wsClient.send({ kind: 'settings.getAdvisorPrompts' });
    return () => { unsub(); };
  }, []);

  const handleSystemChange = useCallback((val: string) => {
    setSystemPrompt(val);
    setDirty(true);
  }, []);

  const handleProactiveChange = useCallback((val: string) => {
    setProactivePrompt(val);
    setDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    setSaving(true);
    wsClient.send({
      kind: 'settings.saveAdvisorPrompts',
      systemPrompt: systemPrompt !== originalSystem ? systemPrompt : undefined,
      proactivePrompt: proactivePrompt !== originalProactive ? proactivePrompt : undefined,
    });
  }, [systemPrompt, proactivePrompt, originalSystem, originalProactive]);

  const handleReset = useCallback(() => {
    wsClient.send({ kind: 'settings.resetAdvisorPrompts' });
  }, []);

  const handleRefreshContext = useCallback(() => {
    setLoadingContext(true);
    wsClient.send({ kind: 'settings.getAdvisorContext' });
  }, []);

  const handleVerbosity = useCallback((v: AdvisorVerbosity) => {
    wsClient.send({ kind: 'settings.advisor', verbosity: v });
  }, []);

  const handleScope = useCallback((s: AdvisorScope) => {
    wsClient.send({ kind: 'settings.advisorScope', scope: s });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* System Prompt */}
      <PromptSection
        label="SYSTEM PROMPT"
        value={systemPrompt}
        onChange={handleSystemChange}
        isCustom={isCustom}
        onReset={handleReset}
      />

      {/* Proactive Prompt Template */}
      <PromptSection
        label="PROACTIVE PROMPT TEMPLATE"
        value={proactivePrompt}
        onChange={handleProactiveChange}
        isCustom={isCustom}
        onReset={handleReset}
        rows={4}
      />

      {/* Save button */}
      {dirty && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={() => {
              setSystemPrompt(originalSystem);
              setProactivePrompt(originalProactive);
              setDirty(false);
            }}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: 6,
              color: colors.text.muted,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '8px 20px',
              background: saving ? colors.surface.hover : colors.accent.blue,
              border: 'none',
              borderRadius: 6,
              color: colors.text.primary,
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Advisor Behavior */}
      <div>
        <div style={{
          fontSize: 12,
          textTransform: 'uppercase' as const,
          letterSpacing: 0.8,
          color: colors.text.secondary,
          marginBottom: 10,
        }}>
          ADVISOR BEHAVIOR
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Verbosity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, color: colors.text.muted, width: 70 }}>Verbosity</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['quiet', 'normal', 'verbose'] as AdvisorVerbosity[]).map((v) => (
                <button
                  key={v}
                  onClick={() => handleVerbosity(v)}
                  style={{
                    padding: '5px 14px',
                    background: verbosity === v ? `${colors.accent.blue}25` : 'transparent',
                    border: `1px solid ${verbosity === v ? colors.accent.blue : colors.border.subtle}`,
                    borderRadius: 4,
                    color: verbosity === v ? colors.accent.blueLight : colors.text.muted,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Scope */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, color: colors.text.muted, width: 70 }}>Scope</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['session', 'global'] as AdvisorScope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => handleScope(s)}
                  style={{
                    padding: '5px 14px',
                    background: scope === s ? `${colors.accent.blue}25` : 'transparent',
                    border: `1px solid ${scope === s ? colors.accent.blue : colors.border.subtle}`,
                    borderRadius: 4,
                    color: scope === s ? colors.accent.blueLight : colors.text.muted,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Context Preview */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{
            fontSize: 12,
            textTransform: 'uppercase' as const,
            letterSpacing: 0.8,
            color: colors.text.secondary,
          }}>
            ADVISOR CONTEXT PREVIEW
          </span>
          <button
            onClick={handleRefreshContext}
            disabled={loadingContext}
            style={{
              padding: '4px 12px',
              background: 'transparent',
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: 4,
              color: colors.text.muted,
              fontSize: 11,
              cursor: loadingContext ? 'not-allowed' : 'pointer',
              opacity: loadingContext ? 0.5 : 1,
            }}
          >
            {loadingContext ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        <div style={{
          background: colors.bg.primary,
          border: `1px solid ${colors.border.subtle}`,
          borderRadius: 6,
          padding: 12,
          fontFamily: fonts.mono,
          fontSize: 11,
          color: colors.text.secondary,
          whiteSpace: 'pre-wrap',
          lineHeight: 1.5,
          maxHeight: 280,
          overflowY: 'auto',
          minHeight: 80,
        }}>
          {contextPreview
            ? contextPreview.split('\n').map((line, i) => {
                const isUser = /^\s+U:/.test(line);
                return (
                  <div key={i} style={isUser ? { color: colors.accent.blueLight } : undefined}>
                    {line || '\u00A0'}
                  </div>
                );
              })
            : 'Click "Refresh" to see the session story.'
          }
        </div>
        <div style={{
          fontSize: 10,
          color: colors.text.muted,
          marginTop: 6,
        }}>
          The session story — goal, work phases, current activity, and recent actions. This is what the advisor sees.
        </div>
      </div>
    </div>
  );
}

/* ─── Prompt Section ─── */

function PromptSection({ label, value, onChange, isCustom, onReset, rows = 7 }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isCustom: boolean;
  onReset: () => void;
  rows?: number;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{
          fontSize: 12,
          textTransform: 'uppercase' as const,
          letterSpacing: 0.8,
          color: colors.text.secondary,
        }}>
          {label}
        </span>
        {isCustom && (
          <button
            onClick={onReset}
            style={{
              padding: '3px 10px',
              background: 'transparent',
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: 4,
              color: colors.text.muted,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Reset to default
          </button>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        style={{
          width: '100%',
          padding: 12,
          background: colors.bg.primary,
          border: `1px solid ${colors.border.subtle}`,
          borderRadius: 6,
          color: colors.text.primary,
          fontFamily: fonts.mono,
          fontSize: 12,
          lineHeight: 1.5,
          resize: 'vertical',
          outline: 'none',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = colors.accent.blue; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = colors.border.subtle; }}
      />
      <div style={{
        fontSize: 10,
        color: colors.text.muted,
        textAlign: 'right' as const,
        marginTop: 4,
      }}>
        {value.length} chars
      </div>
    </div>
  );
}

/* ─── Key Field (reused from original) ─── */

function KeyField({ label, isSet, value, onChange, onClear, placeholder }: {
  label: string;
  isSet: boolean;
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
  placeholder: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          color: colors.text.secondary,
        }}>
          {label}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11,
            fontFamily: fonts.mono,
            color: isSet ? colors.status.successLight : colors.text.muted,
          }}>
            {isSet ? 'Set' : 'Not set'}
          </span>
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: isSet ? colors.status.successLight : colors.text.muted,
            boxShadow: isSet ? `0 0 4px ${colors.status.successLight}` : 'none',
          }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isSet ? '••••••••' : placeholder}
          style={{
            flex: 1,
            padding: '8px 12px',
            background: colors.bg.primary,
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: 6,
            color: colors.text.primary,
            fontFamily: fonts.mono,
            fontSize: 13,
            outline: 'none',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = colors.accent.blue; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = colors.border.subtle; }}
        />
        {isSet && (
          <button
            onClick={onClear}
            style={{
              padding: '8px 12px',
              background: `${colors.status.errorLight}15`,
              border: `1px solid ${colors.status.errorLight}30`,
              borderRadius: 6,
              color: colors.status.errorLight,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
