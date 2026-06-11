import type { DecisionCard } from '../types';

interface Props {
  files: string[];                       // map.topGravity, ranked
  cardByFile: Map<string, DecisionCard>; // primaryFile -> card (if documented)
  onSelect: (id: string) => void;
}

// The N files a new engineer should read first (highest gravity).
export function StartHere({ files, cardByFile, onSelect }: Props) {
  if (!files || files.length === 0) return null;
  return (
    <div className="start-here">
      <div className="section-label">Start Here · most depended-upon files</div>
      <ol className="sh-list">
        {files.slice(0, 8).map((f, i) => {
          const card = cardByFile.get(f);
          return (
            <li key={f} className={`sh-item ${card ? 'has-card' : ''}`}
                onClick={() => card && onSelect(card.id)}>
              <span className="sh-rank">{i + 1}</span>
              <span className="sh-path">{f}</span>
              {card
                ? <span className="sh-tag documented">documented</span>
                : <span className="sh-tag">not yet reviewed</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
