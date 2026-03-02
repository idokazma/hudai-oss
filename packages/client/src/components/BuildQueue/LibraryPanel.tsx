import { useState } from 'react';
import { useLibraryStore } from '../../stores/library-store.js';
import { colors, alpha, fonts } from '../../theme/tokens.js';
import type { ModuleShelf, FileCard } from '@hudai/shared';

export function LibraryPanel() {
  const overview = useLibraryStore((s) => s.overview);
  const modules = useLibraryStore((s) => s.modules);
  const isBuilding = useLibraryStore((s) => s.isBuilding);
  const buildProgress = useLibraryStore((s) => s.buildProgress);
  const [selectedModule, setSelectedModule] = useState<ModuleShelf | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  // Building state
  if (isBuilding && buildProgress) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <div style={{ fontSize: 13, color: colors.text.muted, marginBottom: 8 }}>
            Building library...
          </div>
          <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text.secondary, marginBottom: 8 }}>
            {buildProgress.label}
          </div>
          <div style={{ height: 3, background: colors.surface.hover, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              width: buildProgress.total > 0 ? `${(buildProgress.current / buildProgress.total) * 100}%` : '0%',
              height: '100%',
              background: colors.accent.blue,
              borderRadius: 2,
              transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.text.muted, marginTop: 6 }}>
            {buildProgress.current}/{buildProgress.total} ({buildProgress.phase})
          </div>
        </div>
      </div>
    );
  }

  // No data yet
  if (!overview || modules.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        fontSize: 13,
        color: colors.text.muted,
        textAlign: 'center',
        lineHeight: 1.6,
      }}>
        <div>
          No library data
          <br />
          <span style={{ fontSize: 12 }}>Library builds automatically when a session is attached</span>
        </div>
      </div>
    );
  }

  const activeModule = selectedModule ?? modules[0];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingTop: 36 }}>
      {/* Project overview header */}
      <div style={{
        padding: '10px 16px 8px',
        borderBottom: `1px solid ${colors.border.subtle}`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div style={{ fontSize: 14, fontFamily: fonts.mono, color: colors.text.primary, fontWeight: 600 }}>
            {overview.name}
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {overview.stack.slice(0, 4).map((s) => (
              <span key={s} style={tagStyle}>{s}</span>
            ))}
            <span style={{ ...tagStyle, borderColor: colors.accent.orange + '55', color: colors.accent.orange }}>
              {overview.architectureStyle}
            </span>
          </div>
        </div>
        <div style={{
          fontSize: 12, fontFamily: fonts.mono, color: colors.text.muted,
          lineHeight: 1.5, marginTop: 4,
        }}>
          {overview.description}
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: Module list */}
        <div style={{
          width: 280,
          flexShrink: 0,
          borderRight: `1px solid ${colors.border.subtle}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '6px 12px',
            fontSize: 10,
            fontFamily: fonts.mono,
            color: colors.text.muted,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            borderBottom: `1px solid ${colors.border.subtle}22`,
            flexShrink: 0,
          }}>
            Modules ({modules.length})
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {modules.map((mod) => {
              const isActive = activeModule.slug === mod.slug;
              return (
                <button
                  key={mod.slug}
                  onClick={() => { setSelectedModule(mod); setExpandedCard(null); }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 12px',
                    background: isActive ? alpha(colors.accent.primary, 0.12) : 'none',
                    border: 'none',
                    borderLeft: `3px solid ${isActive ? colors.accent.blue : 'transparent'}`,
                    borderBottom: `1px solid ${colors.border.subtle}22`,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = colors.surface.base; }}
                  onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'none'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 12, fontFamily: fonts.mono,
                      color: isActive ? colors.text.primary : colors.text.secondary,
                      fontWeight: isActive ? 600 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      flex: 1,
                    }}>
                      {mod.name}
                    </span>
                    <span style={{
                      fontSize: 10, fontFamily: fonts.mono, color: colors.text.muted,
                      background: colors.surface.raised, padding: '1px 5px', borderRadius: 3,
                      flexShrink: 0,
                    }}>
                      {mod.fileCards.length}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 11, fontFamily: fonts.mono, color: colors.text.muted,
                    marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {mod.purpose.split('.')[0]}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: File cards for selected module */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Module header */}
          <div style={{
            padding: '8px 16px',
            borderBottom: `1px solid ${colors.border.subtle}`,
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 13, fontFamily: fonts.mono, color: colors.text.primary, fontWeight: 600,
              }}>
                {activeModule.name}
              </span>
              <span style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.text.muted }}>
                {activeModule.fileCards.length} files
              </span>
            </div>
            <div style={{
              fontSize: 12, fontFamily: fonts.mono, color: colors.text.secondary,
              lineHeight: 1.5, marginTop: 4,
            }}>
              {activeModule.purpose}
            </div>
            {activeModule.patterns.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                {activeModule.patterns.map((p) => (
                  <span key={p} style={tagStyle}>{p}</span>
                ))}
              </div>
            )}
            {activeModule.dependsOn.length > 0 && (
              <div style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.text.muted, marginTop: 4 }}>
                depends on: {activeModule.dependsOn.join(', ')}
              </div>
            )}
          </div>

          {/* File cards */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {activeModule.fileCards.map((fc) => (
              <FileCardItem
                key={fc.filePath}
                card={fc}
                expanded={expandedCard === fc.filePath}
                onToggle={() => setExpandedCard(expandedCard === fc.filePath ? null : fc.filePath)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FileCardItem({ card, expanded, onToggle }: { card: FileCard; expanded: boolean; onToggle: () => void }) {
  const basename = card.filePath.split('/').pop() ?? card.filePath;

  return (
    <div style={{ borderBottom: `1px solid ${colors.border.subtle}22` }}>
      <button
        onClick={onToggle}
        style={{
          display: 'block',
          width: '100%',
          padding: '6px 16px',
          background: expanded ? alpha(colors.accent.primary, 0.06) : 'none',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.background = colors.surface.base; }}
        onMouseLeave={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.background = 'none'; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: colors.text.muted, fontFamily: fonts.mono, flexShrink: 0 }}>
            {expanded ? '▾' : '▸'}
          </span>
          <span style={{
            fontSize: 12, fontFamily: fonts.mono, color: colors.text.primary,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}>
            {basename}
          </span>
          {card.exports.length > 0 && (
            <span style={{
              fontSize: 9, fontFamily: fonts.mono, color: colors.text.muted,
              background: colors.surface.raised, padding: '0px 4px', borderRadius: 3,
              flexShrink: 0,
            }}>
              {card.exports.length} exports
            </span>
          )}
        </div>
        <div style={{
          fontSize: 11, fontFamily: fonts.mono, color: colors.text.muted,
          marginTop: 1, marginLeft: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {card.purpose}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '4px 16px 10px 32px' }}>
          {/* Key logic */}
          <div style={{
            fontSize: 11, fontFamily: fonts.mono, color: colors.text.secondary,
            lineHeight: 1.5, marginBottom: 6,
          }}>
            {card.keyLogic}
          </div>

          {/* Full path */}
          <div style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.text.muted, marginBottom: 6 }}>
            {card.filePath}
          </div>

          {/* Exports */}
          {card.exports.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={sectionLabelStyle}>Exports</div>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {card.exports.map((ex) => (
                  <span key={ex} style={tagStyle}>{ex}</span>
                ))}
              </div>
            </div>
          )}

          {/* Dependencies */}
          {card.dependencies.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={sectionLabelStyle}>Dependencies</div>
              <div style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.text.muted, lineHeight: 1.5 }}>
                {card.dependencies.map((d) => d.split('/').pop()).join(', ')}
              </div>
            </div>
          )}

          {/* Side effects */}
          {card.sideEffects.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={sectionLabelStyle}>Side Effects</div>
              {card.sideEffects.map((se) => (
                <div key={se} style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.status.warning, lineHeight: 1.5 }}>
                  {se}
                </div>
              ))}
            </div>
          )}

          {/* Gotchas */}
          {card.gotchas.length > 0 && (
            <div>
              <div style={sectionLabelStyle}>Gotchas</div>
              {card.gotchas.map((g) => (
                <div key={g} style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.status.error, lineHeight: 1.5 }}>
                  {g}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const tagStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: fonts.mono,
  padding: '1px 5px',
  borderRadius: 3,
  border: `1px solid ${colors.border.subtle}`,
  color: colors.text.muted,
  lineHeight: 1.4,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: fonts.mono,
  color: colors.text.muted,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 2,
};
