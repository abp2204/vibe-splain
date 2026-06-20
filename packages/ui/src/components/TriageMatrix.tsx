import { useMemo, type ReactNode } from 'react';
import type { DecisionCard } from '../types';
import { categoryStyle } from '../categories';
import { Term } from './Term';

interface Props {
  cards: DecisionCard[];
  onSelect: (id: string) => void;
}

const HEAT_MIDLINE = 40; // heat is absolute: 0 = clean, 40+ = real debt

type QuadKey = 'fixFirst' | 'isolatedDebt' | 'stableCore' | 'backwater';

interface QuadMeta {
  key: QuadKey;
  title: string;
  sub: ReactNode;
  accent: string;       // border / label color
}

const SMELLY = <Term k="smelly">smelly</Term>;
const LOAD_BEARING = <Term k="loadBearing">load-bearing</Term>;
const CLEAN = <Term k="clean">clean</Term>;

const QUADS: Record<QuadKey, QuadMeta> = {
  isolatedDebt: { key: 'isolatedDebt', title: 'Isolated Debt',  sub: <>{SMELLY} · not {LOAD_BEARING}</>, accent: '#f5a623' },
  fixFirst:     { key: 'fixFirst',     title: '⚠ Fix First',    sub: <>{LOAD_BEARING} · {SMELLY}</>,     accent: '#ff4d5e' },
  backwater:    { key: 'backwater',    title: 'Backwater',      sub: <>low impact · {CLEAN}</>,          accent: '#6b7280' },
  stableCore:   { key: 'stableCore',   title: '✦ Stable Core',  sub: <>{LOAD_BEARING} · {CLEAN}</>,       accent: '#3ddc97' },
};

function median(nums: number[]): number {
  if (nums.length === 0) return 50;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function base(path?: string, fallback?: string): string {
  if (!path) return fallback ?? '—';
  const segs = path.split('/');
  return segs[segs.length - 1];
}

export function TriageMatrix({ cards, onSelect }: Props) {
  const { buckets, empty } = useMemo(() => {
    const plotted = cards.filter(c => typeof c.gravity === 'number' && typeof c.heat === 'number');
    const gMid = median(plotted.map(c => c.gravity!));
    const b: Record<QuadKey, DecisionCard[]> = { fixFirst: [], isolatedDebt: [], stableCore: [], backwater: [] };
    for (const c of plotted) {
      const hot = c.heat! >= HEAT_MIDLINE;
      const heavy = c.gravity! >= gMid;
      const key: QuadKey = hot ? (heavy ? 'fixFirst' : 'isolatedDebt') : (heavy ? 'stableCore' : 'backwater');
      b[key].push(c);
    }
    // sort: hot quadrants by heat/severity desc; clean quadrants by gravity desc
    b.fixFirst.sort((a, z) => (z.severity ?? 0) - (a.severity ?? 0) || z.heat! - a.heat!);
    b.isolatedDebt.sort((a, z) => z.heat! - a.heat!);
    b.stableCore.sort((a, z) => z.gravity! - a.gravity!);
    b.backwater.sort((a, z) => z.gravity! - a.gravity!);
    return { buckets: b, empty: plotted.length === 0 };
  }, [cards]);

  if (empty) {
    return (
      <div className="tm-empty">
        No documented files yet — the triage grid fills in as the agent writes cards.
      </div>
    );
  }

  const order: QuadKey[] = ['isolatedDebt', 'fixFirst', 'backwater', 'stableCore'];

  return (
    <div className="triage-matrix">
      {order.map(key => {
        const q = QUADS[key];
        const items = buckets[key];
        return (
          <div key={key} className={`tm-cell tm-${key}`} style={{ ['--accent' as string]: q.accent }}>
            <div className="tm-cell-head">
              <span className="tm-title">{q.title}</span>
              <span className="tm-count">{items.length}</span>
            </div>
            <div className="tm-sub">{q.sub}</div>
            <div className="tm-chips">
              {items.length === 0
                ? <span className="tm-none">nothing here</span>
                : items.map(c => {
                    const s = categoryStyle(c.category);
                    const metric = c.heat! >= HEAT_MIDLINE ? `h${Math.round(c.heat!)}` : `g${Math.round(c.gravity!)}`;
                    return (
                      <button key={c.id} className="tm-chip" onClick={() => onSelect(c.id)}
                              title={`${c.title} · ${s.label} · gravity ${Math.round(c.gravity!)} · heat ${Math.round(c.heat!)}`}>
                        <span className="tm-dot" style={{ background: s.color }} />
                        <span className="tm-name">{base(c.primaryFile, c.title)}</span>
                        {typeof c.severity === 'number' && c.severity >= 4 && (
                          <span className="tm-sev" style={{ color: s.color, borderColor: s.color }}>{`sev${c.severity}`}</span>
                        )}
                        <span className="tm-metric">{metric}</span>
                      </button>
                    );
                  })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
