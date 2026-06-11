import type { DecisionCard } from '../types';
import { MermaidDiagram } from './MermaidDiagram';

interface DecisionCardProps {
  card: DecisionCard;
  onViewEvidence: () => void;
}

export function DecisionCardComponent({ card, onViewEvidence }: DecisionCardProps) {
  return (
    <div className={`decision-card ${card.status === 'stale' ? 'stale' : ''}`}>
      <div className="card-header">
        <div className="card-title">
          {card.title}
        </div>
        <span className={`card-status ${card.status}`}>
          {card.status === 'fresh' ? '● Fresh' : '⚠ Stale'}
        </span>
      </div>
      <p className="card-narrative">{card.narrative}</p>
      {card.diagram && <MermaidDiagram chart={card.diagram} />}
      <div className="card-footer">
        <button className="evidence-btn" onClick={onViewEvidence}>
          View Evidence
        </button>
        <span className="evidence-count">
          {card.evidence.length} file{card.evidence.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}
