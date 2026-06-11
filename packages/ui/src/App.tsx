import { useMemo, useRef, useState } from 'react';
import type { Dossier, Evidence, DecisionCard } from './types';
import { Header } from './components/Header';
import { PillarTabs } from './components/PillarTabs';
import { DecisionCardComponent } from './components/DecisionCard';
import { EvidenceSidebar } from './components/EvidenceSidebar';
import { TriageMatrix } from './components/TriageMatrix';
import { StartHere } from './components/StartHere';

function App() {
  const [dossier] = useState<Dossier>(() => window.__VIBE_DOSSIER__);
  const [activePillar, setActivePillar] = useState<string>(
    dossier?.pillars[0]?.name ?? ''
  );
  const [activeEvidence, setActiveEvidence] = useState<Evidence[] | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Hooks must run before any early return.
  const allCards = useMemo<DecisionCard[]>(() => {
    if (!dossier) return [];
    const byId = new Map<string, DecisionCard>();
    for (const p of dossier.pillars) for (const c of p.decisions) byId.set(c.id, c);
    for (const c of dossier.wildDiscoveries) byId.set(c.id, c);
    return [...byId.values()];
  }, [dossier]);

  const cardByFile = useMemo(() => {
    const m = new Map<string, DecisionCard>();
    for (const c of allCards) if (c.primaryFile && !m.has(c.primaryFile)) m.set(c.primaryFile, c);
    return m;
  }, [allCards]);

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

  const map = dossier.map;
  const wild = [...dossier.wildDiscoveries].sort(
    (a, b) => (b.severity ?? 0) - (a.severity ?? 0) || (b.heat ?? 0) - (a.heat ?? 0)
  );
  const pillarCards = dossier.pillars.find(p => p.name === activePillar)?.decisions ?? [];

  function scrollToCard(id: string) {
    const el = cardRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1400);
  }
  const setRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
  };

  return (
    <div className="app-layout">
      <Header dossier={dossier} />

      <main className="main-content">
        {map && (
          <section className="overview">
            {map.stack.length > 0 && (
              <div className="stack-row">
                {map.stack.map(s => <span key={s} className="stack-chip">{s}</span>)}
                <span className="overview-stat">{map.realSourceCount} real-source / {map.fileCount} files</span>
              </div>
            )}
            {map.brief && <p className="project-brief">{map.brief}</p>}
          </section>
        )}

        <section className="map-section">
          <div className="section-label">Triage — what to fix first</div>
          <TriageMatrix cards={allCards} onSelect={scrollToCard} />
        </section>

        {map && <StartHere files={map.topGravity} cardByFile={cardByFile} onSelect={scrollToCard} />}

        {wild.length > 0 && (
          <section className="wild-hero">
            <div className="section-label hero-label">🔥 Wild Discoveries — important AND smelly</div>
            {wild.map(card => (
              <DecisionCardComponent
                key={`wild-${card.id}`}
                ref={setRef(card.id)}
                card={card}
                onViewEvidence={() => setActiveEvidence(card.evidence)}
              />
            ))}
          </section>
        )}

        <section className="pillars-section">
          <div className="section-label">Decision Cards by pillar</div>
          <PillarTabs
            pillars={dossier.pillars}
            wildCount={0}
            activePillar={activePillar}
            onSelect={setActivePillar}
          />
          {pillarCards.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-title">No Decision Cards Yet</div>
              <div className="empty-state-text">
                Cards appear here as your coding agent reviews the high-gravity files.
              </div>
            </div>
          ) : (
            pillarCards.map(card => (
              <DecisionCardComponent
                key={card.id}
                ref={setRef(card.id)}
                card={card}
                onViewEvidence={() => setActiveEvidence(card.evidence)}
              />
            ))
          )}
        </section>
      </main>

      <EvidenceSidebar evidence={activeEvidence} onClose={() => setActiveEvidence(null)} />
    </div>
  );
}

export default App;
