import {
  useRef, useState, useLayoutEffect, useCallback, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY } from '../glossary';

interface TermProps {
  k: string;          // glossary key
  children: ReactNode; // what to render inline (defaults to the term label)
}

interface Pos { left: number; top: number; arrow: number; flip: boolean }

const MARGIN = 8;   // keep this far from the viewport edge
const GAP = 10;     // distance between term and tooltip

// Inline jargon with an accessible tooltip.
// Fires on hover, keyboard focus, AND tap — works on touch + a11y.
// Rendered in a portal on <body> so transformed/filtered ancestors
// (card hover translateY, header backdrop-filter) can't clip or
// mis-anchor it, and so its position is truly viewport-relative.
export function Term({ k, children }: TermProps) {
  const entry = GLOSSARY[k];
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);

  const place = useCallback(() => {
    const el = ref.current;
    const tip = tipRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const tw = tip?.offsetWidth ?? 280;
    const th = tip?.offsetHeight ?? 80;

    const centerX = r.left + r.width / 2;
    let left = centerX - tw / 2;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - tw - MARGIN));

    // flip below the term if there isn't room above
    const flip = r.top - th - GAP < MARGIN;
    const top = flip ? r.bottom + GAP : r.top - th - GAP;

    setPos({ left, top, arrow: centerX - left, flip });
  }, []);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => { setOpen(false); setPos(null); }, []);

  // measure once the tooltip is in the DOM, then position it
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open, place, hide]);

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
      onClick={(e) => { e.stopPropagation(); open ? hide() : show(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}
    >
      {children ?? entry.term}
      {open && createPortal(
        <span
          ref={tipRef}
          className={`term-tip ${pos?.flip ? 'flip' : ''}`}
          role="tooltip"
          style={{
            left: pos?.left ?? -9999,
            top: pos?.top ?? -9999,
            visibility: pos ? 'visible' : 'hidden',
            ['--arrow' as string]: `${pos?.arrow ?? 0}px`,
          }}
        >
          <span className="term-tip-head">{entry.term}</span>
          <span className="term-tip-body">{entry.def}</span>
        </span>,
        document.body,
      )}
    </span>
  );
}
