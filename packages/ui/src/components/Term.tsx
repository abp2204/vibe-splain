import { useRef, useState, useCallback, type ReactNode } from 'react';
import { GLOSSARY } from '../glossary';

interface TermProps {
  k: string;          // glossary key
  children: ReactNode; // what to render inline (defaults to the term label)
}

// Inline jargon with an accessible, anti-clipping tooltip.
// Fires on hover, keyboard focus, AND tap — so it works on touch + a11y too.
// Tooltip is position:fixed so cards / matrix overflow never clip it.
export function Term({ k, children }: TermProps) {
  const entry = GLOSSARY[k];
  const ref = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const toggle = useCallback(() => (tip ? hide() : show()), [tip, hide, show]);

  if (!entry) return <>{children}</>;

  return (
    <span
      ref={ref}
      className="term"
      tabIndex={0}
      role="button"
      aria-label={`${entry.term}: ${entry.def}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(e) => { e.stopPropagation(); toggle(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}
    >
      {children ?? entry.term}
      {tip && (
        <span
          className="term-tip"
          role="tooltip"
          style={{ left: tip.x, top: tip.y }}
        >
          <span className="term-tip-head">{entry.term}</span>
          <span className="term-tip-body">{entry.def}</span>
        </span>
      )}
    </span>
  );
}
