import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { MapScene } from './components/MapScene';
import { BuildingPanel } from './components/BuildingPanel';
import { LayerControls } from './components/LayerControls';
import { RiskLegend } from './components/RiskLegend';
import { DemoController, useDemoRunner, type DemoTarget } from './components/DemoController';
import { loadBuildings } from './data/loadBuildings';
import { loadPredictions } from './data/loadPredictions';
import { featureCentroid, joinByBin } from './data/joinByBin';
import { INITIAL_CAMERA, prefersReducedMotion } from './camera';
import type { JoinResult, PredictionSet } from './types/predictions';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; join: JoinResult; predictions: PredictionSet };

export default function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [showRisk, setShowRisk] = useState(true);
  const [showMovement, setShowMovement] = useState(false);
  const [selectedBin, setSelectedBin] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [basemapError, setBasemapError] = useState<string | null>(null);
  const mapRef = useRef<MapRef>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoad({ status: 'loading' });
    Promise.all([loadBuildings(undefined, ctrl.signal), loadPredictions(undefined, ctrl.signal)])
      .then(([buildings, predictions]) => {
        const join = joinByBin(buildings, predictions);
        if (join.unmatchedPredictions.length) {
          console.info(`[join] ${join.unmatchedPredictions.length} prediction(s) have no footprint in the demo area.`);
        }
        setLoad({ status: 'ready', join, predictions });
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
    return { map, target: demoTarget, setShowRisk, setShowMovement, setSelectedBin, setPanelOpen };
  }, [demoTarget]);
  const demo = useDemoRunner(getActions);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (demo.running) demo.stop();
        else setPanelOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [demo]);

  const select = useCallback(
    (bin: string | null, fly = false) => {
      demo.stop();
      setSelectedBin(bin);
      setPanelOpen(bin !== null);
      const f = bin ? join?.scored.find((s) => s.properties.bin === bin) : undefined;
      const map = mapRef.current?.getMap();
      if (fly && f && map) {
        map.flyTo({
          center: featureCentroid(f),
          zoom: Math.max(map.getZoom(), 16.2),
          pitch: 60,
          padding: { top: 40, bottom: 40, left: 40, right: 420 },
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

  if (load.status !== 'ready' || !join || !predictions) {
    return (
      <div className="splash">
        <div className="splash__card">
          <h1 className="title">NYC Structural Risk Digital Twin</h1>
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
  const movementAvailable =
    isMock || join.scored.some((f) => typeof f.properties.prediction?.factors.sar_velocity_mm_year === 'number');

  return (
    <div className={`app${demo.running ? ' app--demo' : ''}`}>
      <MapScene
        ref={mapRef}
        join={join}
        dataMode={predictions.data_mode}
        showRisk={showRisk}
        showMovement={showMovement && movementAvailable}
        selectedBin={selectedBin}
        onSelect={(bin) => select(bin)}
        onUserInteract={demo.stop}
        onBasemapError={setBasemapError}
      />
      <div className="vignette" aria-hidden />

      <header className="topbar">
        <div className="brand">
          <h1 className="title">NYC Structural Risk Digital Twin</h1>
          <p className="subtitle">Façade inspection priority · Lower Manhattan</p>
        </div>
        <div className="badges">
          <span className="badge badge--ibm">
            <span className="badge__dot" aria-hidden />
            Predictions generated on {predictions.model.execution_platform}
          </span>
          {isMock && (
            <span className="badge badge--mock" title="Synthetic demonstration values, not model output">
              Mock data
            </span>
          )}
        </div>
      </header>

      <aside className="panel sidebar">
        <LayerControls
          showRisk={showRisk}
          showMovement={showMovement && movementAvailable}
          movementAvailable={movementAvailable}
          demoRunning={demo.running}
          onToggleRisk={() => setShowRisk((v) => !v)}
          onToggleMovement={() => setShowMovement((v) => !v)}
          onPlayDemo={demo.start}
          onReset={resetView}
        />
        <RiskLegend scored={join.scored} selectedBin={selectedBin} onSelect={(bin) => select(bin, true)} />
        <p className="sidebar__foot muted small">
          {join.scored.length} scored of {join.features.length.toLocaleString()} buildings · model{' '}
          <span className="mono">{predictions.model.version}</span>
        </p>
      </aside>

      {panelOpen && selectedFeature && (
        <BuildingPanel feature={selectedFeature} total={predictions.buildings.length} onClose={() => setPanelOpen(false)} />
      )}

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
