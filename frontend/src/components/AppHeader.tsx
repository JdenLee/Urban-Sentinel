interface AppHeaderProps {
  sidebarOpen: boolean;
  isMock: boolean;
  onToggleSidebar: () => void;
  onOpenModel: () => void;
}

/** The parcel mark and region line give the map a place-specific identity. */
export function AppHeader({ sidebarOpen, isMock, onToggleSidebar, onOpenModel }: AppHeaderProps) {
  return (
    <header className="topbar">
      <button type="button" className="icon-btn drawer-btn"
        aria-label={sidebarOpen ? 'Hide controls' : 'Show controls'} aria-expanded={sidebarOpen}
        aria-controls="sidebar" onClick={onToggleSidebar}>
        <svg viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true">
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      <div className="brand">
        {/* A crisp Empire State-inspired silhouette: setbacks, vertical ribs and a tall spire. */}
        <svg className="brand__mark" viewBox="0 0 28 42" fill="none" aria-hidden="true">
          <path d="M3 41V28h4V17h3V10h3V6h2v4h3v7h3v11h4v13Z" fill="currentColor" />
          <path d="M14 1v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M11 20v18m6-18v18M14 13v25M6 31v7m16-7v7" stroke="var(--mat-opaque)" strokeWidth="1.1" />
        </svg>
        <div>
          <h1 className="title">Urban Sentinel</h1>
          <p className="subtitle">Façade inspection atlas</p>
        </div>
      </div>
      <div className="map-edition">
        <span className="map-edition__index">New York City</span>
        <span>Lower Manhattan</span>
      </div>
      <div className="header-actions">
        {isMock && <span className="mock-label">Mock data</span>}
        <button type="button" className="model-link" onClick={onOpenModel}>
          Data &amp; model <span aria-hidden="true">↗</span>
        </button>
      </div>
    </header>
  );
}
