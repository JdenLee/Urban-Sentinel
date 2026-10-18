import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { MapScene } from './components/MapScene';
import { AppHeader } from './components/AppHeader';
import { BuildingPanel } from './components/BuildingPanel';
import { LayerControls } from './components/LayerControls';
import { RiskLegend } from './components/RiskLegend';
import { SearchBox, Shortlist } from './components/Shortlist';
import { MovementLegend } from './components/MovementLegend';
import { ModelCardDialog } from './components/ModelCard';
import { MapToolbar } from './components/MapToolbar';
import { DemoController, useDemoRunner, type DemoTarget } from './components/DemoController';
import { loadBuildings } from './data/loadBuildings';
import { loadPredictionsWithFallback } from './data/loadPredictions';
import { loadGroundMotion, type GroundMotionLayer } from './data/loadGroundMotion';
import type { PredictionSource } from './config';
import { DEFAULT_HEIGHT_M, featureCentroid, joinByBin } from './data/joinByBin';
import { DEFAULT_MATERIAL } from './data/facadeMaterials';
import { fetchFootprint, fetchHistory } from './data/loadHistory';
import { useAssignments } from './data/shortlist';
import { INITIAL_CAMERA, prefersReducedMotion } from './camera';
import { formatDate } from './data/formatDate';
import { API_BASE } from './config';
import { displayHeight } from './data/landmarks';
import { useMediaQuery } from './motion/useMediaQuery';
import { chooseDemoBuilding } from './data/demoScript';
import { fetchBuildingFacts } from './data/buildingFacts';
import {
  PRIORITIES,
  type BuildingFeature,
  type HistoryState,
  type JoinedFeature,
  type JoinResult,
  type LookupTarget,
  type PredictionSet,
  type Priority,
} from './types/predictions';

export const APP_TITLE = 'Urban Sentinel';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; join: JoinResult; predictions: PredictionSet; source: PredictionSource; groundMotion: GroundMotionLayer | null };

/** Below this width the rail and the building dock cannot both sit beside the map. */
const NARROW_QUERY = '(max-width: 1100px)';
const isNarrow = () => typeof window !== 'undefined' && window.matchMedia?.(NARROW_QUERY).matches === true;

/** Below this width the record becomes a draggable bottom sheet rather than a side card (glass.css). */
const SHEET_QUERY = '(max-width: 760px)';
const isSheet = () => typeof window !== 'undefined' && window.matchMedia?.(SHEET_QUERY).matches === true;

/** Panel widths are defined in glass.css and change at breakpoints; read them rather than restating them. */
function cssPx(name: string, fallback: number) {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

/** A fetched footprint for a building outside the demo area, shaped like a scene feature. */
function toJoined(f: BuildingFeature): JoinedFeature {
  const h = f.properties.height_m;
  const hasHeight = typeof h === 'number' && h > 0;
  return {
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      ...f.properties,
      height_m: hasHeight ? h : DEFAULT_HEIGHT_M,
      height_estimated: !hasHeight,
      material: f.properties.material ?? DEFAULT_MATERIAL,
      material_source: f.properties.material_source ?? 'inferred',
      prediction: null,
    },
  };
}

const fmtDate = formatDate;

export default function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [showRisk, setShowRisk] = useState(true);
  const [showMovement, setShowMovement] = useState(false);
  const [selectedBin, setSelectedBin] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<'orbit' | 'pan'>('orbit');
  const [flat, setFlat] = useState(false);
  const [orbiting, setOrbiting] = useState(false);
  const flatRef = useRef(flat);
  flatRef.current = flat;
  const [modelCardOpen, setModelCardOpen] = useState(false);
  const [visiblePriorities, setVisiblePriorities] = useState<Set<Priority>>(() => new Set(PRIORITIES));
  const [capacity, setCapacity] = useState(25);
  const [shortlistOnly, setShortlistOnly] = useState(false);
  const [basemapError, setBasemapError] = useState<string | null>(null);
  const assignments = useAssignments();
  const mapRef = useRef<MapRef>(null);
  const [history, setHistory] = useState<HistoryState>({ status: 'idle' });
  const [lookupLabel, setLookupLabel] = useState<string | null>(null);
  const [external, setExternal] = useState<JoinedFeature | null>(null);
  /** Set when a lookup had no coordinates yet: fly once the footprint or history provides them. */
  const pendingFly = useRef(false);

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
    const top = chooseDemoBuilding(join?.scored ?? []);
    return top ? { bin: top.properties.bin, center: featureCentroid(top), height_m: top.properties.height_m } : null;
  }, [join]);

  /**
   * The panels float over the map, so the camera has to frame the building into whatever strip of
   * window they leave uncovered. Reading the live open state keeps the building centred in what the
   * user can actually see rather than in the window.
   */
  const framing = useRef({ sidebar: false });
  framing.current.sidebar = sidebarOpen;

  const getActions = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return null;
    const openPanel = (v: boolean) => {
      setPanelOpen(v);
      setOrbiting(v);
      if (v && isNarrow()) setSidebarOpen(false);
    };
    return {
      map,
      target: demoTarget,
      deskOpen: () => framing.current.sidebar,
      setShowRisk,
      setShowMovement,
      setSelectedBin,
      setPanelOpen: openPanel,
    };
  }, [demoTarget]);
  const demo = useDemoRunner(getActions);
  const interruptMotion = useCallback(() => { demo.stop(); setOrbiting(false); }, [demo.stop]);

  const startDemo = useCallback(() => {
    // The demo tells the full story, so clear any filters first.
    setVisiblePriorities(new Set(PRIORITIES));
    setShortlistOnly(false);
    setModelCardOpen(false);
    setFlat(false);
    flatRef.current = false;
    setSidebarOpen(false);
    framing.current.sidebar = false;
    setOrbiting(false);
    if (demoTarget) void fetchBuildingFacts(demoTarget.bin).catch(() => {});
    demo.start();
  }, [demo, demoTarget]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modelCardOpen || e.defaultPrevented) return;
      if (demo.running) demo.stop();
      else setPanelOpen(false);
      setOrbiting(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [demo, modelCardOpen]);

  const featureByBin = useMemo(() => new Map((join?.features ?? []).map((f) => [f.properties.bin, f])), [join]);

  const flyTo = useCallback((center: [number, number], height = 0) => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const inset = cssPx('--inset', 12);
    const gutter = inset + 16;
    const zoom = height > 300 ? 15.05 : height > 120 ? 15.7 : Math.max(map.getZoom(), 16.2);
    map.flyTo({
      center,
      zoom: zoom - (isSheet() ? (height > 120 ? 1.1 : 0.65) : 0),
      pitch: flatRef.current ? 0 : height > 300 ? 52 : 60,
      padding: isSheet()
        ? { top: height > 300 ? 130 : 72, bottom: Math.round(window.innerHeight * 0.68), left: gutter, right: gutter }
        : {
            top: height > 300 ? 190 : 80,
            bottom: 80,
            left: framing.current.sidebar ? inset + cssPx('--rail', 322) + 16 : gutter,
            right: inset + cssPx('--dock', 384) + 16,
          },
      duration: prefersReducedMotion() ? 0 : 2200,
    });
  }, []);

  /** Select any building: a scene footprint (map click, shortlist, search) or a looked-up BIN. */
  const select = useCallback(
    (bin: string | null, fly = false, target?: LookupTarget) => {
      demo.stop();
      setOrbiting(bin !== null && !flatRef.current && !prefersReducedMotion());
      setSelectedBin(bin);
      setPanelOpen(bin !== null);
      setLookupLabel(target?.label ?? null);
      pendingFly.current = false;
      if (bin) { setSidebarOpen(false); framing.current.sidebar = false; }
      if (!bin || !fly) return;
      const f = featureByBin.get(bin);
      if (f) flyTo(featureCentroid(f), displayHeight(f));
      else if (target?.lonLat) flyTo(target.lonLat);
      else pendingFly.current = true;
    },
    [demo, featureByBin, flyTo],
  );
  const lookup = useCallback((target: LookupTarget) => select(target.bin, true, target), [select]);

  // Narrowing the window stacks the desk over the record, since neither leaves room for the other
  // below 1100px. Whichever the user opened last wins, and that is always the record.
  const narrow = useMediaQuery(NARROW_QUERY);
  useEffect(() => {
    if (narrow && panelOpen && selectedBin) setSidebarOpen(false);
  }, [narrow, panelOpen, selectedBin]);

  /** Selected building without a priority colour: an unscored scene footprint or a fetched external one. */
  const highlight = useMemo(() => {
    if (!selectedBin) return null;
    const f = featureByBin.get(selectedBin);
    if (f) return f.properties.prediction ? null : { feature: f, external: false };
    return external ? { feature: external, external: true } : null;
  }, [selectedBin, featureByBin, external]);

  // Building history from the ML API, for whichever building is selected.
  useEffect(() => {
    if (!selectedBin) {
      setHistory({ status: 'idle' });
      return;
    }
    if (!API_BASE) {
      setHistory({ status: 'unavailable' });
      return;
    }
    const ctrl = new AbortController();
    setHistory({ status: 'loading' });
    fetchHistory(selectedBin, ctrl.signal)
      .then((data) => {
        setHistory({ status: 'ready', data });
        if (pendingFly.current && data.lonLat) {
          pendingFly.current = false;
          flyTo(data.lonLat);
        }
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setHistory({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [selectedBin, flyTo]);

  // Footprint for a selected building outside the demo area, so it can be drawn and framed.
  useEffect(() => {
    setExternal(null);
    if (!selectedBin || featureByBin.has(selectedBin)) return;
    const ctrl = new AbortController();
    fetchFootprint(selectedBin, ctrl.signal)
      .then((fp) => {
        if (!fp) return;
        const jf = toJoined(fp);
        setExternal(jf);
        if (pendingFly.current) {
          pendingFly.current = false;
          flyTo(featureCentroid(jf), displayHeight(jf));
        }
      })
      .catch(() => {
        /* footprint is decoration; the panel still works without it */
      });
    return () => ctrl.abort();
  }, [selectedBin, featureByBin, flyTo]);

  const resetView = useCallback(() => {
    demo.stop();
    setPanelOpen(false);
    setSelectedBin(null);
    setFlat(false);
    setOrbiting(false);
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

  const selectedFeature = selectedBin ? featureByBin.get(selectedBin) ?? null : null;
  const scenePrediction = selectedFeature?.properties.prediction ?? null;
  const panelPrediction = scenePrediction ?? (history.status === 'ready' ? history.data.prediction : null);

  const isMock = predictions.data_mode === 'mock';
  const groundMotion = load.groundMotion;
  const movementAvailable =
    isMock || !!groundMotion || join.scored.some((f) => typeof f.properties.prediction?.factors.sar_velocity_mm_year === 'number');
  const scoreIsProbability = join.scored.every((f) => f.properties.prediction!.probability === f.properties.prediction!.score);
  const movementOn = showMovement && movementAvailable;
  // Legend facts come from the measured layer itself when it is loaded (period, product, pixel size).
  const gm = groundMotion?.metadata as Record<string, unknown> | undefined;
  const gmStr = (k: string) => (typeof gm?.[k] === 'string' ? (gm[k] as string) : null);
  const movementMeta = gm
    ? {
        ...predictions.movement,
        measurement: gmStr('measurement') ?? predictions.movement.measurement,
        units: gmStr('units') ?? predictions.movement.units,
        source: [gmStr('product'), gmStr('frame')].filter(Boolean).join(', ') || predictions.movement.source,
        posting_m: typeof gm.pixel_size_m === 'number' ? gm.pixel_size_m : predictions.movement.posting_m,
        period_start: gmStr('observation_start') ?? predictions.movement.period_start,
        period_end: gmStr('observation_end') ?? predictions.movement.period_end,
      }
    : predictions.movement;

  return (
    <div className={`app${demo.running ? ' app--demo' : ''}${sidebarOpen ? ' app--sidebar' : ''}${panelOpen && selectedBin ? ' app--panel' : ''}`}
      onPointerDownCapture={(event) => {
        if ((event.target as Element).closest('.maplibregl-ctrl-group')) interruptMotion();
      }}>
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
        highlight={highlight}
        onSelect={(bin) => select(bin, bin !== null)}
        onUserInteract={interruptMotion}
        onBasemapError={setBasemapError}
        cameraMode={cameraMode}
        flat={flat}
        autoOrbit={orbiting && panelOpen && !flat && !demo.paused}
        demoRunning={demo.running}
        demoOpeningPhase={demo.openingPhase}
        demoRunId={demo.runId}
        demoPaused={demo.paused}
      />

      <AppHeader sidebarOpen={sidebarOpen} isMock={isMock}
        onToggleSidebar={() => setSidebarOpen((v) => !v)} onOpenModel={() => setModelCardOpen(true)} />

      <div className="explorer-search panel">
        <SearchBox scored={join.scored} features={join.features} onSelect={(bin) => select(bin, true)} onLookup={lookup} />
      </div>
      {!sidebarOpen && <div className="map-key panel" aria-label="Inspection priority legend">
        <button type="button" className="map-key__toggle" aria-pressed={showRisk} onClick={() => setShowRisk((v) => !v)}>
          Inspection priority <span>{showRisk ? 'On' : 'Off'}</span>
        </button>
        <div className="map-key__ramp" aria-hidden />
        <div className="map-key__labels"><span>Low</span><span>Medium</span><span>High</span><span>Critical</span></div>
        <p>Gray = no prediction · Click a building to explore</p>
        <button type="button" className="text-link" onClick={() => setSidebarOpen(true)}>Explore priorities &amp; layers →</button>
      </div>}
      <MapToolbar mode={cameraMode} flat={flat} onMode={(mode) => { interruptMotion(); setCameraMode(mode); }} onReset={resetView}
        onNorth={() => { interruptMotion(); mapRef.current?.getMap().easeTo({ bearing: 0, duration: prefersReducedMotion() ? 0 : 600 }); }}
        onDimension={() => {
          interruptMotion();
          setFlat((v) => !v);
          mapRef.current?.getMap().easeTo({ pitch: flat ? 55 : 0, duration: prefersReducedMotion() ? 0 : 700 });
        }} />

      <aside id="sidebar" className="panel sidebar" aria-label="Map controls" hidden={!sidebarOpen}>
        <div className="workspace-heading">
          <span className="workspace-heading__label">Explore the city</span>
          <span className="workspace-heading__count mono">{join.scored.length.toLocaleString()} scored / {join.features.length.toLocaleString()} mapped</span>
        </div>
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
        <details className="explore-section">
        <summary>Priority filters &amp; coverage</summary>
        <RiskLegend
          scored={join.scored}
          features={join.features}
          coverage={predictions.coverage}
          visible={visiblePriorities}
          scoreLabel={scoreIsProbability ? 'Probability' : 'Score 0–1'}
          onToggle={togglePriority}
        />
        </details>
        <details className="explore-section" open>
        <summary>Where to inspect first</summary>
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
        </details>
        <div className="sidebar__foot">
          <span>Data as of <span className="mono">{fmtDate(predictions.data_as_of)}</span></span>
          <span>{isMock ? 'Synthetic demo data' : `Scored on ${predictions.model.execution_platform}`}</span>
          <button type="button" className="text-link" onClick={() => setModelCardOpen(true)}>View sources &amp; methodology ↗</button>
        </div>
      </aside>

      {movementOn && <MovementLegend meta={movementMeta} mode={predictions.data_mode} />}

      {panelOpen && selectedBin && (
        <BuildingPanel
          key={selectedBin}
          bin={selectedBin}
          feature={selectedFeature}
          coverageLabels={predictions.coverage?.labels ?? null}
          geometry={selectedFeature?.geometry ?? highlight?.feature.geometry ?? null}
          geometryHeightM={highlight?.feature.properties.height_m ?? null}
          prediction={panelPrediction}
          predictionGeneratedAt={scenePrediction ? predictions.generated_at : null}
          predictionIsMock={Boolean(scenePrediction) && isMock}
          history={history}
          fallbackTitle={lookupLabel}
          rankScope={scenePrediction ? 'area' : 'citywide'}
          total={predictions.buildings.length}
          capacity={capacity}
          modelCard={predictions.model_card}
          status={assignments.get(selectedBin)}
          onStatusChange={(s) => assignments.set(selectedBin, s)}
          onOpenModelCard={() => setModelCardOpen(true)}
          onClose={() => { interruptMotion(); setPanelOpen(false); }}
          isMock={isMock}
          orbiting={orbiting && !flat && !prefersReducedMotion()}
          orbitAvailable={!flat && !prefersReducedMotion()}
          onToggleOrbit={() => { demo.stop(); setOrbiting((v) => !v); }}
          demoCue={demo.cue}
          demoRunId={demo.runId}
          demoRunning={demo.running}
          demoAwaitingInference={demo.awaitingInference}
          demoAwaitingHistory={demo.awaitingHistory}
          onDemoHistoryComplete={demo.completeHistory}
          onDemoInferenceStart={demo.beginInference}
          onDemoInferenceComplete={demo.completeInference}
          onDemoInterrupt={() => { if (demo.paused && !demo.awaitingInference && !demo.awaitingHistory) demo.releaseCue(); else demo.stop(); }}
        />
      )}

      {modelCardOpen && <ModelCardDialog predictions={predictions} source={load.source} onClose={() => setModelCardOpen(false)} />}

      <DemoController running={demo.running} paused={demo.paused} awaitingInference={demo.awaitingInference} awaitingHistory={demo.awaitingHistory} inferenceBusy={demo.inferenceBusy} elapsed={demo.elapsed} stage={demo.stage} onContinue={demo.resume} onSkipInference={demo.skipInference} onStop={interruptMotion} />

      <footer className="map-source">
        {join.scored.length.toLocaleString()} predictions · {fmtDate(predictions.data_as_of)}
        <span> · {load.source.label} · {isMock ? 'Synthetic demo' : predictions.model.execution_platform}</span>
      </footer>

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
