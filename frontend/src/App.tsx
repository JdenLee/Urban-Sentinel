import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { MapScene } from './components/MapScene';
import { BuildingPanel } from './components/BuildingPanel';
import { LayerControls } from './components/LayerControls';
import { RiskLegend } from './components/RiskLegend';
import { SearchBox, Shortlist } from './components/Shortlist';
import { MovementLegend } from './components/MovementLegend';
import { ModelCardDialog } from './components/ModelCard';
import { DemoController, useDemoRunner, type DemoTarget } from './components/DemoController';
import { loadBuildings } from './data/loadBuildings';
import { loadPredictionsWithFallback } from './data/loadPredictions';
import { loadGroundMotion, type GroundMotionLayer } from './data/loadGroundMotion';
import type { PredictionSource } from './config';
import { featureCentroid, joinByBin } from './data/joinByBin';
import { useAssignments } from './data/shortlist';
import { INITIAL_CAMERA, prefersReducedMotion } from './camera';
import { PRIORITIES, type JoinResult, type PredictionSet, type Priority } from './types/predictions';

export const APP_TITLE = 'NYC Façade Early-Warning System';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; join: JoinResult; predictions: PredictionSet; source: PredictionSource; groundMotion: GroundMotionLayer | null };

/** Below this width the sidebar and building panel cannot both fit beside the map. */
const NARROW_QUERY = '(max-width: 1100px)';
const isNarrow = () => typeof window !== 'undefined' && window.matchMedia?.(NARROW_QUERY).matches === true;

const fmtDate = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
};

export default function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [showRisk, setShowRisk] = useState(true);
  const [showMovement, setShowMovement] = useState(false);
  const [selectedBin, setSelectedBin] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrow());
  const [modelCardOpen, setModelCardOpen] = useState(false);
  const [visiblePriorities, setVisiblePriorities] = useState<Set<Priority>>(() => new Set(PRIORITIES));
  const [capacity, setCapacity] = useState(25);
  const [shortlistOnly, setShortlistOnly] = useState(false);
  const [basemapError, setBasemapError] = useState<string | null>(null);
  const assignments = useAssignments();
  const mapRef = useRef<MapRef>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoad({ status: 'loading' });
    Promise.all([loadBuildings(undefined, ctrl.signal), loadPredictionsWithFallback(ctrl.signal), loadGroundMotion(ctrl.signal)])
      .then(([buildings, { set: predictions, source, failures }, groundMotion]) => {
        if (failures.length) console.info('[predictions] fell back past:', failures);
        const join = joinByBin(buildings, predictions);
        if (join.unmatchedPredictions.length) {
          console.info(`[join] ${join.unmatchedPredictions.length} prediction(s) have no footprint in the demo area.`);
        }
        // Real ground motion is only paired with real predictions; mock mode keeps its own labelled layer.
        setLoad({ status: 'ready', join, predictions, source, groundMotion: predictions.data_mode === 'real' ? groundMotion : null });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [attempt]);

  const join = load.status === 'ready' ? load.join : null;
  const predictions = load.status === 'ready' ? load.predictions : null;

  const demoTarget = useMemo<DemoTarget | null>(() => {
    const top = join?.scored[0];
    return top ? { bin: top.properties.bin, center: featureCentroid(top), height_m: top.properties.height_m } : null;
  }, [join]);

  const getActions = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return null;
    const openPanel = (v: boolean) => {
      setPanelOpen(v);
      if (v && isNarrow()) setSidebarOpen(false);
    };
    return { map, target: demoTarget, setShowRisk, setShowMovement, setSelectedBin, setPanelOpen: openPanel };
  }, [demoTarget]);
  const demo = useDemoRunner(getActions);

  const startDemo = useCallback(() => {
    // The demo tells the full story, so clear any filters first.
    setVisiblePriorities(new Set(PRIORITIES));
    setShortlistOnly(false);
    setModelCardOpen(false);
    demo.start();
  }, [demo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modelCardOpen) return;
      if (demo.running) demo.stop();
      else setPanelOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [demo, modelCardOpen]);

  const select = useCallback(
    (bin: string | null, fly = false) => {
      demo.stop();
      setSelectedBin(bin);
      setPanelOpen(bin !== null);
      if (bin && isNarrow()) setSidebarOpen(false);
      const f = bin ? join?.scored.find((s) => s.properties.bin === bin) : undefined;
      const map = mapRef.current?.getMap();
      if (fly && f && map) {
        map.flyTo({
          center: featureCentroid(f),
          zoom: Math.max(map.getZoom(), 16.2),
          pitch: 60,
          padding: isNarrow() ? { top: 40, bottom: 40, left: 20, right: 20 } : { top: 40, bottom: 40, left: 340, right: 420 },
          duration: prefersReducedMotion() ? 0 : 2200,
        });
      }
    },
    [demo, join],
  );

  const resetView = useCallback(() => {
    demo.stop();
    setPanelOpen(false);
    setSelectedBin(null);
    mapRef.current?.getMap().flyTo({
      ...INITIAL_CAMERA,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      duration: prefersReducedMotion() ? 0 : 2400,
    });
  }, [demo]);

  const togglePriority = useCallback((p: Priority) => {
    setVisiblePriorities((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next.size ? next : new Set(PRIORITIES);
    });
  }, []);

  if (load.status !== 'ready' || !join || !predictions) {
    return (
      <div className="splash">
        <div className="splash__card">
          <h1 className="title">{APP_TITLE}</h1>
          {load.status === 'loading' ? (
            <p className="muted">
              <span className="spinner" aria-hidden /> Loading building footprints and predictions…
            </p>
          ) : (
            <>
              <p className="error-text">{load.status === 'error' ? load.message : 'Unknown error'}</p>
              <p className="muted small">
                Check that <code>public/data/buildings-demo.geojson</code> and <code>public/data/mock-predictions.json</code>{' '}
                exist and are valid JSON. See frontend/README.md.
              </p>
              <button type="button" className="btn btn--primary" onClick={() => setAttempt((a) => a + 1)}>
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const selectedFeature = selectedBin ? join.scored.find((f) => f.properties.bin === selectedBin) : undefined;
  const isMock = predictions.data_mode === 'mock';
  const groundMotion = load.groundMotion;
  const movementAvailable =
    isMock || !!groundMotion || join.scored.some((f) => typeof f.properties.prediction?.factors.sar_velocity_mm_year === 'number');
  const scoreIsProbability = join.scored.every((f) => f.properties.prediction!.probability === f.properties.prediction!.score);
  const movementOn = showMovement && movementAvailable;

  return (
    <div className={`app${demo.running ? ' app--demo' : ''}${sidebarOpen ? ' app--sidebar' : ''}${panelOpen && selectedFeature ? ' app--panel' : ''}`}>
      <MapScene
        ref={mapRef}
        join={join}
        dataMode={predictions.data_mode}
        showRisk={showRisk}
        showMovement={movementOn}
        selectedBin={selectedBin}
        visiblePriorities={visiblePriorities}
        capacityCutoff={shortlistOnly ? capacity : null}
        hexRadius={predictions.movement.aggregation_m}
        externalMovement={groundMotion?.points ?? null}
        onSelect={(bin) => select(bin)}
        onUserInteract={demo.stop}
        onBasemapError={setBasemapError}
      />
      <div className="vignette" aria-hidden />

      <header className="topbar">
        <button
          type="button"
          className="icon-btn drawer-btn"
          aria-label={sidebarOpen ? 'Hide controls' : 'Show controls'}
          aria-expanded={sidebarOpen}
          aria-controls="sidebar"
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <span aria-hidden>{sidebarOpen ? '‹' : '☰'}</span>
        </button>
        <div className="brand">
          <h1 className="title">{APP_TITLE}</h1>
          <p className="subtitle">Façade inspection priority · Lower Manhattan · data-driven, not a structural simulation</p>
        </div>
        <div className="badges">
          {isMock ? (
            <span className="badge badge--runtime" title="Mock predictions were not produced by the model">
              Target runtime: {predictions.model.execution_platform}
            </span>
          ) : (
            <span className="badge badge--ibm">
              <span className="badge__dot" aria-hidden />
              Predictions generated on {predictions.model.execution_platform}
            </span>
          )}
          {!isMock && (
            <span className="badge" title={load.source.url}>
              Source: {load.source.label}
            </span>
          )}
          {isMock && (
            <span className="badge badge--mock" title="Synthetic demonstration values, not model output">
              Mock data
            </span>
          )}
          <button type="button" className="badge badge--btn" onClick={() => setModelCardOpen(true)}>
            Model card
          </button>
        </div>
      </header>

      <aside id="sidebar" className="panel sidebar" aria-label="Map controls" hidden={!sidebarOpen}>
        <SearchBox scored={join.scored} onSelect={(bin) => select(bin, true)} />
        <LayerControls
          showRisk={showRisk}
          showMovement={movementOn}
          movementAvailable={movementAvailable}
          demoRunning={demo.running}
          onToggleRisk={() => setShowRisk((v) => !v)}
          onToggleMovement={() => setShowMovement((v) => !v)}
          onPlayDemo={startDemo}
          onReset={resetView}
        />
        <RiskLegend
          scored={join.scored}
          visible={visiblePriorities}
          scoreLabel={scoreIsProbability ? 'Probability' : 'Score 0–1'}
          onToggle={togglePriority}
        />
        <Shortlist
          scored={join.scored}
          capacity={capacity}
          shortlistOnly={shortlistOnly}
          selectedBin={selectedBin}
          status={assignments.get}
          onCapacity={setCapacity}
          onShortlistOnly={setShortlistOnly}
          onSelect={(bin) => select(bin, true)}
        />
        <dl className="kv kv--tight sidebar__foot">
          <div className="kv__row">
            <dt>Data as of</dt>
            <dd className="mono">{fmtDate(predictions.data_as_of)}</dd>
          </div>
          <div className="kv__row">
            <dt>Model trained through</dt>
            <dd className="mono">{fmtDate(predictions.model.trained_through)}</dd>
          </div>
          <div className="kv__row">
            <dt>Last refresh</dt>
            <dd className="mono">{fmtDate(predictions.generated_at)}</dd>
          </div>
          <div className="kv__row">
            <dt>Model</dt>
            <dd className="mono">{predictions.model.version}</dd>
          </div>
          <div className="kv__row">
            <dt>Coverage</dt>
            <dd className="mono">
              {join.scored.length} / {join.features.length.toLocaleString()} bldgs
            </dd>
          </div>
        </dl>
      </aside>

      {movementOn && <MovementLegend meta={predictions.movement} mode={predictions.data_mode} />}

      {panelOpen && selectedFeature && (
        <BuildingPanel
          key={selectedFeature.properties.bin}
          feature={selectedFeature}
          total={predictions.buildings.length}
          capacity={capacity}
          modelCard={predictions.model_card}
          status={assignments.get(selectedFeature.properties.bin)}
          onStatusChange={(s) => assignments.set(selectedFeature.properties.bin, s)}
          onOpenModelCard={() => setModelCardOpen(true)}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {modelCardOpen && <ModelCardDialog predictions={predictions} onClose={() => setModelCardOpen(false)} />}

      <DemoController running={demo.running} elapsed={demo.elapsed} stage={demo.stage} onStop={demo.stop} />

      {basemapError && (
        <div className="toast" role="alert">
          Basemap unavailable ({basemapError}). Scored buildings still render.
          <button type="button" className="icon-btn" onClick={() => setBasemapError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
