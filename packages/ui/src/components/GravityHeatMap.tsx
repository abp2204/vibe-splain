import { useMemo } from 'react';
import type { DecisionCard } from '../types';
import { categoryStyle } from '../categories';

interface Props {
  cards: DecisionCard[];
  onSelect: (id: string) => void;
}

// Scatter: x = gravity (importance), y = heat (smell). Dot size = severity,
// color = category. Top-right quadrant = important AND smelly = start here.
export function GravityHeatMap({ cards, onSelect }: Props) {
  const plotted = useMemo(
    () => cards.filter(c => typeof c.gravity === 'number' && typeof c.heat === 'number'),
    [cards],
  );

  const W = 760, H = 420, PAD = 44;
  const px = (g: number) => PAD + (g / 100) * (W - PAD * 2);
  const py = (h: number) => H - PAD - (h / 100) * (H - PAD * 2);

  if (plotted.length === 0) {
    return (
      <div className="hm-empty">
        No plottable cards yet — the map fills in as the agent writes cards with gravity/heat.
      </div>
    );
  }

  return (
    <div className="heatmap">
      <svg viewBox={`0 0 ${W} ${H}`} className="heatmap-svg" role="img" aria-label="Gravity by Heat scatter">
        {/* hot quadrant highlight (top-right) */}
        <rect x={px(50)} y={py(100)} width={W - PAD - px(50)} height={py(50) - py(100)}
              fill="rgba(255,77,94,0.06)" />
        <text x={W - PAD - 6} y={py(100) + 16} className="hm-quadrant" textAnchor="end">
          🔥 Important AND Smelly — start here
        </text>

        {/* axes */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className="hm-axis" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} className="hm-axis" />
        <text x={W / 2} y={H - 8} className="hm-axis-label" textAnchor="middle">Gravity — how load-bearing →</text>
        <text x={14} y={H / 2} className="hm-axis-label" textAnchor="middle"
              transform={`rotate(-90 14 ${H / 2})`}>Heat — how smelly →</text>

        {plotted.map(c => {
          const s = categoryStyle(c.category);
          const r = 5 + (c.severity ?? 2) * 2.4;
          return (
            <circle
              key={c.id}
              cx={px(c.gravity!)} cy={py(c.heat!)} r={r}
              fill={s.color} fillOpacity={0.7} stroke={s.color} strokeOpacity={0.9}
              className="hm-dot"
              onClick={() => onSelect(c.id)}
            >
              <title>{`${c.title}\n${s.label} · sev ${c.severity ?? '?'} · gravity ${Math.round(c.gravity!)} · heat ${Math.round(c.heat!)}`}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
