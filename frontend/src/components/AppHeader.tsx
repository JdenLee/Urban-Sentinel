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
        {/* A setback skyscraper with lit windows and a beacon on its spire. */}
        <svg className="brand__mark" viewBox="0 0 34 34" fill="none" aria-hidden="true">
          <path d="M8 33V24H10V15H12V8H14.5V5H19.5V8H22V15H24V24H26V33Z" fill="currentColor" />
          <path d="M10.2 25.6h1.6v1.6h-1.6zM13.2 25.6h1.6v1.6h-1.6zM16.2 25.6h1.6v1.6h-1.6zM19.2 25.6h1.6v1.6h-1.6zM22.2 25.6h1.6v1.6h-1.6zM10.2 28.4h1.6v1.6h-1.6zM13.2 28.4h1.6v1.6h-1.6zM16.2 28.4h1.6v1.6h-1.6zM19.2 28.4h1.6v1.6h-1.6zM22.2 28.4h1.6v1.6h-1.6zM11.7 16.6h1.6v1.6h-1.6zM14.7 16.6h1.6v1.6h-1.6zM17.7 16.6h1.6v1.6h-1.6zM20.7 16.6h1.6v1.6h-1.6zM11.7 19.4h1.6v1.6h-1.6zM14.7 19.4h1.6v1.6h-1.6zM17.7 19.4h1.6v1.6h-1.6zM20.7 19.4h1.6v1.6h-1.6zM14.7 9.6h1.6v1.6h-1.6zM17.7 9.6h1.6v1.6h-1.6zM14.7 12.4h1.6v1.6h-1.6zM17.7 12.4h1.6v1.6h-1.6zM15.5 33v-3.4h3V33z" fill="var(--mat-opaque)" />
          <path d="M17 5V2.4" stroke="currentColor" strokeWidth="1.2" />
          <circle className="brand__beacon" cx="17" cy="1.8" r="1.4" fill="currentColor" />
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
