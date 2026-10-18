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
        <svg className="brand__mark" viewBox="0 0 34 34" fill="none" aria-hidden="true">
          <path d="M2 2h12v12H2zM20 2h12v12H20zM2 20h12v12H2z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M20 20h12v12H20z" fill="currentColor" />
          <path d="M25 25h2v2h-2z" fill="var(--chassis)" />
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
