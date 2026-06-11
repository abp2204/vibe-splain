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

export function EvidenceSidebar({ evidence, onClose }: EvidenceSidebarProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<Map<string, string>>(new Map());
  const highlighterRef = useRef<any>(null);

  useEffect(() => {
    // Dynamically import shiki
    import('shiki').then(async ({ createHighlighter }) => {
      const highlighter = await createHighlighter({
        themes: ['tokyo-night'],
        langs: ['typescript', 'javascript', 'tsx', 'jsx', 'python', 'go', 'rust', 'java'],
      });
      highlighterRef.current = highlighter;
    }).catch(err => {
      console.error('Failed to load Shiki:', err);
    });
  }, []);

  useEffect(() => {
    if (!evidence || !highlighterRef.current) return;

    const newHtml = new Map<string, string>();
    for (const e of evidence) {
      const lang = e.file.endsWith('.tsx') ? 'tsx'
        : e.file.endsWith('.jsx') ? 'jsx'
        : e.file.endsWith('.ts') ? 'typescript'
        : e.file.endsWith('.py') ? 'python'
        : e.file.endsWith('.go') ? 'go'
        : e.file.endsWith('.rs') ? 'rust'
        : e.file.endsWith('.java') ? 'java'
        : 'javascript';

      try {
        let html = highlighterRef.current.codeToHtml(e.snippet, {
          lang,
          theme: 'tokyo-night',
        });
        // Post-process: wrap lines in the evidence range with highlight class
        const lines = html.split('\n');
        const highlighted = lines.map((line: string, i: number) => {
          const lineNum = e.startLine + i;
          if (lineNum >= e.startLine && lineNum <= e.endLine) {
            return `<span class="evidence-highlight">${line}</span>`;
          }
          return line;
        });
        newHtml.set(`${e.file}:${e.startLine}-${e.endLine}`, highlighted.join('\n'));
      } catch {
        newHtml.set(`${e.file}:${e.startLine}-${e.endLine}`, `<pre><code>${escapeHtml(e.snippet)}</code></pre>`);
      }
    }
    setHighlightedHtml(newHtml);
  }, [evidence]);

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

        return (
          <div key={i} className="evidence-item">
            <div className="evidence-breadcrumb">
              {dirs.map((d, j) => (
                <span key={j}>
                  {d}
                  <span className="separator"> / </span>
                </span>
              ))}
              <span className="filename">{fileName}</span>
              <span className="lines">[Lines {e.startLine}–{e.endLine}]</span>
            </div>
            <div className="code-block">
              {highlightedHtml.has(key) ? (
                <div dangerouslySetInnerHTML={{ __html: highlightedHtml.get(key)! }} />
              ) : (
                <pre><code>{e.snippet}</code></pre>
              )}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
