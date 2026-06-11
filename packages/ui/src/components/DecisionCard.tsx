import { forwardRef } from 'react';
import type { DecisionCard } from '../types';
import { MermaidDiagram } from './MermaidDiagram';
import { categoryStyle } from '../categories';

interface DecisionCardProps {
  card: DecisionCard;
  onViewEvidence: () => void;
}

function SeverityPips({ severity }: { severity: number }) {
  return (
    <span className="sev-pips" title={`severity ${severity}/5`}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} className={`pip ${n <= severity ? 'on' : ''}`} />
      ))}
    </span>
  );
}

export const DecisionCardComponent = forwardRef<HTMLDivElement, DecisionCardProps>(
  function DecisionCardComponent({ card, onViewEvidence }, ref) {
    const s = categoryStyle(card.category);
    return (
      <div
        ref={ref}
        className={`decision-card ${card.status === 'stale' ? 'stale' : ''}`}
        style={{ ['--cat-color' as string]: s.color }}
      >
        <div className="card-top">
          <div className="card-chips">
            {card.category && (
              <span className="cat-chip" style={{ color: s.color, borderColor: s.color, background: `${s.color}1f` }}>
                {s.glyph} {s.label}
              </span>
            )}
            {typeof card.severity === 'number' && <SeverityPips severity={card.severity} />}
          </div>
          <span className={`card-status ${card.status}`}>
            {card.status === 'fresh' ? '● Fresh' : '⚠ Stale'}
          </span>
        </div>

        {card.thesis
          ? <p className="card-thesis">{card.thesis}</p>
          : <div className="card-title">{card.title}</div>}

        {card.thesis && <div className="card-subtitle">{card.title}</div>}

        <p className="card-narrative">{card.narrative}</p>

        {(card.blastRadius || card.tradeoff) && (
          <div className="card-rows">
            {card.blastRadius && (
              <div className="card-row">
                <span className="row-label">Blast radius</span>
                <span className="row-value">{card.blastRadius}</span>
              </div>
            )}
            {card.tradeoff && (
              <div className="card-row">
                <span className="row-label">Tradeoff</span>
                <span className="row-value">{card.tradeoff}</span>
              </div>
            )}
          </div>
        )}

        {card.diagram && <MermaidDiagram chart={card.diagram} />}

        <div className="card-footer">
          <button className="evidence-btn" onClick={onViewEvidence}>View Evidence</button>
          <span className="evidence-count">
            {card.evidence.length} snippet{card.evidence.length !== 1 ? 's' : ''}
          </span>
          {card.primaryFile && <span className="card-file">{card.primaryFile}</span>}
          {(typeof card.gravity === 'number' || typeof card.heat === 'number') && (
            <span className="card-metrics">
              {typeof card.gravity === 'number' && <>g{Math.round(card.gravity)}</>}
              {typeof card.heat === 'number' && <> · h{Math.round(card.heat)}</>}
            </span>
          )}
        </div>
      </div>
    );
  },
);
