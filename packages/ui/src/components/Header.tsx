import type { Dossier } from '../types';

function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

export function Header({ dossier }: { dossier: Dossier }) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="wordmark">
          <span className="wordmark-glyph">◈</span>
          VIBE-SPLAIN
        </div>
        <div className="project-path">{dossier.projectRoot}</div>
      </div>
      <div className="header-center">
        Analyzed {getRelativeTime(dossier.scannedAt)}
      </div>
      <div className="header-right">
        {dossier.stalePaths.length > 0 && (
          <span className="stale-badge">⚠ {dossier.stalePaths.length} STALE</span>
        )}
        <button className="refresh-btn" onClick={() => window.location.reload()}>
          ↺ Refresh
        </button>
      </div>
    </header>
  );
}
