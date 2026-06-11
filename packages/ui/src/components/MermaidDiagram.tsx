import mermaid from 'mermaid';
import { useEffect, useRef, useState } from 'react';

mermaid.initialize({
  startOnLoad: false,  // CRITICAL — never allow mermaid to auto-scan DOM
  theme: 'dark',
  themeVariables: {
    primaryColor: '#1a1e2a',
    primaryTextColor: '#e8eaf0',
    primaryBorderColor: '#00e5cc',
    lineColor: '#4a5568',
    secondaryColor: '#13161e',
    tertiaryColor: '#0d0f14',
    edgeLabelBackground: '#13161e',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: '13px',
  },
  flowchart: { curve: 'basis' },
});

export function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid.render(id, chart)
      .then(({ svg }) => setSvg(svg))
      .catch(() => setError('Could not render diagram'));
  }, [chart]);

  if (error) return null; // Silently hide broken diagrams
  if (!svg) return <div className="diagram-loading">Rendering diagram...</div>;
  return (
    <div
      className="mermaid-container"
      ref={containerRef}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
