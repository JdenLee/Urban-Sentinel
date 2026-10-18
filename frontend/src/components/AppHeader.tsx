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
        {/* A stepped setback tower under a beacon: the sentinel watching the skyline. */}
        <svg className="brand__mark" viewBox="0 0 34 34" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="brand-tower" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.35" />
              <stop offset="1" stopColor="currentColor" />
            </linearGradient>
          </defs>
          <path d="M10 33V22h2v-9h2V7h2V4.5h2V7h2v6h2v9h2v11z" fill="url(#brand-tower)" />
          <path d="M17 9.5v21.5M13.5 16v15M20.5 16v15" stroke="var(--mat-opaque)" strokeWidth="0.9" />
          <path d="M17 4.5V2.6" stroke="currentColor" strokeWidth="1.2" />
          <circle className="brand__beacon" cx="17" cy="1.8" r="1.5" fill="currentColor" />
          <path d="M5 33h24" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
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
