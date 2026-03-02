import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useGraphStore } from '../../stores/graph-store.js';
import { useDocsStore } from '../../stores/docs-store.js';
import { wsClient } from '../../ws/ws-client.js';
import { colors, fonts } from '../../theme/tokens.js';

interface DirGroup {
  dir: string;
  files: { id: string; label: string }[];
}

export function DocsPanel() {
  const graph = useGraphStore((s) => s.graph);
  const selectedFile = useDocsStore((s) => s.selectedFile);
  const content = useDocsStore((s) => s.content);
  const loading = useDocsStore((s) => s.loading);
  const error = useDocsStore((s) => s.error);
  const editMode = useDocsStore((s) => s.editMode);
  const editContent = useDocsStore((s) => s.editContent);
  const saving = useDocsStore((s) => s.saving);
  const saveError = useDocsStore((s) => s.saveError);
  const setEditMode = useDocsStore((s) => s.setEditMode);
  const setEditContent = useDocsStore((s) => s.setEditContent);
  const close = useDocsStore((s) => s.close);

  const mdFiles = useMemo(() => {
    if (!graph) return [];
    return graph.nodes
      .filter((n) => n.extension === '.md')
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [graph]);

  const grouped = useMemo(() => {
    const groups = new Map<string, DirGroup>();
    for (const f of mdFiles) {
      const dir = f.group || '.';
      if (!groups.has(dir)) groups.set(dir, { dir, files: [] });
      groups.get(dir)!.files.push({ id: f.id, label: f.label });
    }
    return Array.from(groups.values()).sort((a, b) => a.dir.localeCompare(b.dir));
  }, [mdFiles]);

  const handleSelect = (fileId: string) => {
    useDocsStore.getState().selectFile(fileId);
    wsClient.send({ kind: 'file.read', path: fileId });
  };

  const handleRefresh = () => {
    if (selectedFile) {
      // Re-fetch current file
      useDocsStore.getState().selectFile(selectedFile);
      wsClient.send({ kind: 'file.read', path: selectedFile });
    }
  };

  const handleSave = () => {
    if (!selectedFile) return;
    useDocsStore.setState({ saving: true });
    wsClient.send({ kind: 'file.write', path: selectedFile, content: editContent });
  };

  // Viewer mode — showing file content
  if (selectedFile) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${colors.border.subtle}`,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', flex: 1 }}>
            <button
              onClick={close}
              style={{
                background: 'none', border: 'none', color: colors.text.muted,
                cursor: 'pointer', fontSize: 12, padding: '0 4px', lineHeight: 1,
                fontFamily: fonts.mono,
              }}
            >
              ←
            </button>
            <span style={{
              fontSize: 12,
              fontFamily: fonts.mono,
              color: colors.text.primary,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {selectedFile.split('/').pop()}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {!editMode ? (
              <>
              <button
                onClick={handleRefresh}
                style={{
                  padding: '2px 8px', fontSize: 11, fontFamily: fonts.mono,
                  background: colors.surface.raised, border: `1px solid ${colors.border.subtle}`,
                  borderRadius: 3, color: colors.text.muted, cursor: 'pointer',
                  textTransform: 'uppercase', letterSpacing: 0.5,
                }}
                title="Reload file content"
              >
                Refresh
              </button>
              <button
                onClick={() => setEditMode(true)}
                style={{
                  padding: '2px 8px', fontSize: 11, fontFamily: fonts.mono,
                  background: colors.surface.raised, border: `1px solid ${colors.border.subtle}`,
                  borderRadius: 3, color: colors.text.muted, cursor: 'pointer',
                  textTransform: 'uppercase', letterSpacing: 0.5,
                }}
              >
                Edit
              </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditMode(false)}
                  style={{
                    padding: '2px 8px', fontSize: 11, fontFamily: fonts.mono,
                    background: colors.surface.raised, border: `1px solid ${colors.border.subtle}`,
                    borderRadius: 3, color: colors.text.muted, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: '2px 8px', fontSize: 11, fontFamily: fonts.mono,
                    background: colors.accent.blue, border: 'none',
                    borderRadius: 3, color: colors.text.white, cursor: 'pointer',
                    fontWeight: 600, opacity: saving ? 0.5 : 1,
                  }}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Path */}
        <div style={{
          padding: '4px 10px',
          fontSize: 11,
          fontFamily: fonts.mono,
          color: colors.text.muted,
          borderBottom: `1px solid ${colors.border.subtle}`,
          flexShrink: 0,
        }}>
          {selectedFile}
        </div>

        {saveError && (
          <div style={{ padding: '4px 10px', fontSize: 11, color: colors.status.error, fontFamily: fonts.mono }}>
            {saveError}
          </div>
        )}

        {/* Content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px',
        }}>
          {loading ? (
            <span style={{ color: colors.text.muted, fontSize: 12, fontFamily: fonts.mono }}>Loading...</span>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <span style={{ color: colors.status.error, fontSize: 12, fontFamily: fonts.mono }}>
                {error.includes('ENOENT') ? 'File not found — it may have been deleted or moved' : error}
              </span>
              <br />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 8 }}>
                <button
                  onClick={handleRefresh}
                  style={{
                    padding: '4px 12px', fontSize: 11, fontFamily: fonts.mono,
                    background: colors.surface.raised, border: `1px solid ${colors.border.subtle}`,
                    borderRadius: 3, color: colors.text.muted, cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
                <button
                  onClick={close}
                  style={{
                    padding: '4px 12px', fontSize: 11, fontFamily: fonts.mono,
                    background: colors.surface.raised, border: `1px solid ${colors.border.subtle}`,
                    borderRadius: 3, color: colors.text.muted, cursor: 'pointer',
                  }}
                >
                  Back
                </button>
              </div>
            </div>
          ) : editMode ? (
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              style={{
                width: '100%',
                height: '100%',
                background: colors.surface.dimmest,
                border: `1px solid ${colors.border.subtle}`,
                borderRadius: 4,
                color: colors.text.primary,
                fontSize: 13,
                fontFamily: fonts.mono,
                lineHeight: 1.5,
                padding: 8,
                resize: 'none',
                outline: 'none',
              }}
            />
          ) : (
            <div className="docs-markdown" style={{
              fontSize: 13,
              fontFamily: fonts.mono,
              color: colors.text.secondary,
              lineHeight: 1.6,
            }}>
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Markdown styles */}
        <style>{`
          .docs-markdown h1, .docs-markdown h2, .docs-markdown h3 {
            color: ${colors.text.primary};
            margin: 12px 0 6px;
          }
          .docs-markdown h1 { font-size: 14px; }
          .docs-markdown h2 { font-size: 12px; }
          .docs-markdown h3 { font-size: 11px; }
          .docs-markdown p { margin: 6px 0; }
          .docs-markdown code {
            background: ${colors.surface.hover};
            padding: 1px 4px;
            border-radius: 3px;
            font-size: 10px;
          }
          .docs-markdown pre {
            background: ${colors.surface.dimmest};
            padding: 8px;
            border-radius: 4px;
            overflow-x: auto;
            font-size: 10px;
          }
          .docs-markdown pre code {
            background: none;
            padding: 0;
          }
          .docs-markdown a {
            color: ${colors.accent.blueLight};
            text-decoration: none;
          }
          .docs-markdown ul, .docs-markdown ol {
            padding-left: 18px;
            margin: 6px 0;
          }
          .docs-markdown li { margin: 2px 0; }
          .docs-markdown blockquote {
            border-left: 2px solid ${colors.border.subtle};
            padding-left: 10px;
            margin: 6px 0;
            color: ${colors.text.muted};
          }
          .docs-markdown table {
            border-collapse: collapse;
            font-size: 10px;
            width: 100%;
          }
          .docs-markdown th, .docs-markdown td {
            border: 1px solid ${colors.border.subtle};
            padding: 4px 8px;
            text-align: left;
          }
          .docs-markdown th {
            background: ${colors.surface.base};
            color: ${colors.text.primary};
          }
        `}</style>
      </div>
    );
  }

  // File list mode
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '4px 0',
      }}>
        {mdFiles.length === 0 ? (
          <div style={{
            padding: '20px 12px',
            fontSize: 12,
            color: colors.text.muted,
            textAlign: 'center',
            lineHeight: 1.6,
          }}>
            No markdown files found
            <br />
            <span style={{ fontSize: 11 }}>Attach to a session to scan the codebase</span>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.dir}>
              <div style={{
                padding: '6px 12px 2px',
                fontSize: 11,
                fontFamily: fonts.mono,
                color: colors.text.muted,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}>
                {group.dir === '.' ? 'root' : group.dir}
              </div>
              {group.files.map((f) => (
                <button
                  key={f.id}
                  onClick={() => handleSelect(f.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '5px 12px 5px 20px',
                    background: 'none',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: fonts.mono,
                    color: colors.text.secondary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.background = colors.surface.base; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none'; }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
