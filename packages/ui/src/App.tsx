import { useState } from 'react';
import type { Dossier, Evidence } from './types';
import { Header } from './components/Header';
import { PillarTabs } from './components/PillarTabs';
import { DecisionCardComponent } from './components/DecisionCard';
import { EvidenceSidebar } from './components/EvidenceSidebar';

function App() {
  const [dossier] = useState<Dossier>(() => window.__VIBE_DOSSIER__);
  const [activePillar, setActivePillar] = useState<string>(
    dossier?.pillars[0]?.name ?? 'Wild Discoveries'
  );
  const [activeEvidence, setActiveEvidence] = useState<Evidence[] | null>(null);

  if (!dossier) {
    return (
      <div className="empty-state" style={{ height: '100vh' }}>
        <div className="empty-state-icon">◈</div>
        <div className="empty-state-title">No Dossier Data</div>
        <div className="empty-state-text">
          Run <code>scan_project</code> from your coding agent to generate the architectural dossier.
        </div>
      </div>
    );
  }

  const isWild = activePillar === 'Wild Discoveries';
  const currentCards = isWild
    ? dossier.wildDiscoveries
    : dossier.pillars.find(p => p.name === activePillar)?.decisions ?? [];

  return (
    <div className="app-layout">
      <Header dossier={dossier} />
      <PillarTabs
        pillars={dossier.pillars}
        wildCount={dossier.wildDiscoveries.length}
        activePillar={activePillar}
        onSelect={setActivePillar}
      />
      <main className="main-content">
        {currentCards.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">No Decision Cards Yet</div>
            <div className="empty-state-text">
              Your coding agent will create Decision Cards for this pillar after analyzing the high-gravity files.
            </div>
          </div>
        ) : (
          currentCards.map(card => (
            <DecisionCardComponent
              key={card.id}
              card={card}
              onViewEvidence={() => setActiveEvidence(card.evidence)}
            />
          ))
        )}
      </main>
      <EvidenceSidebar
        evidence={activeEvidence}
        onClose={() => setActiveEvidence(null)}
      />
    </div>
  );
}

export default App;
