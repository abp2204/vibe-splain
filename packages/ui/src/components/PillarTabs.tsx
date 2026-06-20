import type { Pillar } from '../types';

interface PillarTabsProps {
  pillars: Pillar[];
  wildCount: number;
  activePillar: string;
  onSelect: (name: string) => void;
}

export function PillarTabs({ pillars, wildCount, activePillar, onSelect }: PillarTabsProps) {
  return (
    <div className="tab-bar">
      {pillars.map(pillar => (
        <button
          key={pillar.name}
          className={`tab ${activePillar === pillar.name ? 'active' : ''}`}
          onClick={() => onSelect(pillar.name)}
        >
          {pillar.name}
          <span className="tab-count">{pillar.cardCount}</span>
        </button>
      ))}
      {wildCount > 0 && (
        <button
          className={`tab wild ${activePillar === 'Wild Discoveries' ? 'active' : ''}`}
          onClick={() => onSelect('Wild Discoveries')}
        >
          ⚡ Wild Discoveries
          <span className="tab-count">{wildCount}</span>
        </button>
      )}
    </div>
  );
}
