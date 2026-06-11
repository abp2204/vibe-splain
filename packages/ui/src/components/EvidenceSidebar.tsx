import { useEffect, useRef, useState } from 'react';
import type { Evidence } from '../types';

interface EvidenceSidebarProps {
  evidence: Evidence[] | null;
  onClose: () => void;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Agents sometimes store escaped newlines/tabs as literal "\n"/"\t" text,
// collapsing a multi-line snippet into one physical line. Restore them so the
// code renders as real lines (and so it wraps instead of scrolling forever).
function normalizeSnippet(s: string): string {
  let out = s.replace(/\r\n/g, '\n');
  if (/\\[nt]/.test(out)) {
    out = out
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '  ');
  }
  // strip trailing whitespace per line + leading/trailing blank lines
  return out.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
}

function langFor(file: string): string {
  if (file.endsWith('.tsx')) return 'tsx';
  if (file.endsWith('.jsx')) return 'jsx';
  if (file.endsWith('.ts')) return 'typescript';
  if (file.endsWith('.py')) return 'python';
  if (file.endsWith('.go')) return 'go';
  if (file.endsWith('.rs')) return 'rust';
  if (file.endsWith('.java')) return 'java';
  return 'javascript';
}

export function EvidenceSidebar({ evidence, onClose }: EvidenceSidebarProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<Map<string, string>>(new Map());
  const highlighterRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    import('shiki').then(async ({ createHighlighter }) => {
      const highlighter = await createHighlighter({
        themes: ['tokyo-night'],
        langs: ['typescript', 'javascript', 'tsx', 'jsx', 'python', 'go', 'rust', 'java'],
      });
      if (!alive) return;
      highlighterRef.current = highlighter;
      setReady(true);
    }).catch(err => console.error('Failed to load Shiki:', err));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!evidence || !ready || !highlighterRef.current) return;
    const map = new Map<string, string>();
    for (const e of evidence) {
      const key = `${e.file}:${e.startLine}-${e.endLine}`;
      const code = normalizeSnippet(e.snippet);
      try {
        map.set(key, highlighterRef.current.codeToHtml(code, {
          lang: langFor(e.file),
          theme: 'tokyo-night',
        }));
      } catch {
        map.set(key, `<pre><code>${escapeHtml(code)}</code></pre>`);
      }
    }
    setHighlightedHtml(map);
  }, [evidence, ready]);

  if (!evidence) {
    return (
      <aside className="evidence-sidebar">
        <div className="sidebar-empty">
          <div className="sidebar-empty-icon">🔍</div>
          <div className="sidebar-empty-text">
            Click "View Evidence" on a Decision Card to inspect the source code.
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="evidence-sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Evidence</span>
        <button className="sidebar-close" onClick={onClose}>✕</button>
      </div>
      {evidence.map((e, i) => {
        const key = `${e.file}:${e.startLine}-${e.endLine}`;
        const pathParts = e.file.split('/');
        const fileName = pathParts.pop() || '';
        const dirs = pathParts;
        const fallback = normalizeSnippet(e.snippet);

        return (
          <div key={i} className="evidence-item">
            <div className="evidence-breadcrumb">
              {dirs.map((d, j) => (
                <span key={j}>{d}<span className="separator"> / </span></span>
              ))}
              <span className="filename">{fileName}</span>
              <span className="lines">[Lines {e.startLine}–{e.endLine}]</span>
            </div>
            <div className="code-block">
              {highlightedHtml.has(key) ? (
                <div dangerouslySetInnerHTML={{ __html: highlightedHtml.get(key)! }} />
              ) : (
                <pre><code>{fallback}</code></pre>
              )}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
