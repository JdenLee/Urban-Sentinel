import { forwardRef, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import Map, { NavigationControl, useMap, type MapRef } from 'react-map-gl/maplibre';
import { AmbientLight, DirectionalLight, LightingEffect, type PickingInfo } from '@deck.gl/core';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { DataMode, JoinedFeature, JoinResult, Priority } from '../types/predictions';
import { buildingRiskLayers } from '../layers/buildingRiskLayer';
import { movementHexagonLayer, movementPoints, type MovementPointDatum } from '../layers/movementHexagonLayer';
import { PRIORITY_LABEL } from '../data/priority';
import { INITIAL_VIEW } from '../camera';
import { sunState } from '../data/sunPosition';
import { adaptBasemapStyle } from '../data/basemapStyle';
import { CinematicOverlay } from './CinematicOverlay';
import { buildingName, landmarkFor } from '../data/landmarks';
import { pickedBuilding } from '../layers/landmarkLayer';
import { useMediaQuery } from '../motion/useMediaQuery';
import { BuildingOrbit } from '../motion/BuildingOrbit';
import { SceneEntrance, ENTRANCE_VIEW } from '../motion/SceneEntrance';
import { pinOffset } from '../motion/sceneMotion';
import { prefersReducedMotion } from '../camera';
import type { DemoOpeningPhase } from '../data/demoScript';

const finishDemoRise = () => {};

export const BASEMAP_STYLE_URL = (import.meta.env.VITE_BASEMAP_STYLE_URL as string | undefined) || 'https://tiles.openfreemap.org/styles/positron';

/**
 * The map fills the window and the panels float above it. That is what gives the translucent
 * surfaces something to sample: a panel docked beside the map would have only page behind it.
 * Camera framing compensates for the overlap through flyTo padding instead (see App.tsx).
 */
const VIEWPORT: React.CSSProperties = { position: 'absolute', inset: 0 };

/** Dark background-only style used if the basemap cannot be fetched; the scored overlay still renders. */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce3e3' } }],
};

function useBasemapStyle(onError: (message: string) => void) {
  const [style, setStyle] = useState<StyleSpecification | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(BASEMAP_STYLE_URL, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<StyleSpecification>;
      })
      .then((s) => setStyle(adaptBasemapStyle(s)))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        onError(err instanceof Error ? err.message : String(err));
        setStyle(FALLBACK_STYLE);
      });
    return () => ctrl.abort();
  }, [onError]);
  return style;
}

export interface MapSceneProps {
  join: JoinResult;
  dataMode: DataMode;
  showRisk: boolean;
  showMovement: boolean;
  selectedBin: string | null;
  visiblePriorities: Set<Priority>;
  capacityCutoff: number | null;
  hexRadius: number;
  /** Real measured movement points (e.g. NASA OPERA DISP-S1); replaces per-building factors when present. */
  externalMovement?: MovementPointDatum[] | null;
  /** Selected building that is not scored (context footprint or a looked-up building outside the demo area). */
  highlight: { feature: JoinedFeature; external: boolean } | null;
  /** Any footprint (scored or not) was clicked; null for empty map. */
  onSelect: (bin: string | null) => void;
  onUserInteract: () => void;
  onBasemapError: (message: string) => void;
  cameraMode: 'orbit' | 'pan';
  flat: boolean;
  autoOrbit: boolean;
  demoRunning: boolean;
  demoOpeningPhase: DemoOpeningPhase;
  demoRunId: number;
  demoPaused: boolean;
}

export const MapScene = forwardRef<MapRef, MapSceneProps>(function MapScene(
  {
    join,
    dataMode,
    showRisk,
    showMovement,
    selectedBin,
    visiblePriorities,
    capacityCutoff,
    hexRadius,
    externalMovement,
    highlight,
    onSelect,
    onUserInteract,
    onBasemapError,
    cameraMode,
    flat,
    autoOrbit,
    demoRunning,
    demoOpeningPhase,
    demoRunId,
    demoPaused,
  },
  ref,
) {
  const dragged = useRef(false);
  const touch = useMediaQuery('(pointer: coarse)');
  const mapStyle = useBasemapStyle(onBasemapError);
  const [ready, setReady] = useState(false);
  const [entrance, setEntrance] = useState(() => !prefersReducedMotion());
  const [entranceRevealed, setEntranceRevealed] = useState(false);
  const [pinMoving, setPinMoving] = useState(false);
  const rise = useRef({ scale: entrance ? .001 : 1, offset: 0 });
  const pin = useRef({ scale: 1, offset: 0 });
  const pinElapsed = useRef(0);
  const initialView = useRef(entrance ? ENTRANCE_VIEW : INITIAL_VIEW);
  const finishEntrance = useCallback(() => { setEntrance(false); }, []);
  const revealEntrance = useCallback(() => { setEntranceRevealed(true); }, []);
  const demoRising = demoRunning && demoOpeningPhase === 'rise';
  const startupActive = entrance && !demoRunning;
  const grayOpening = (startupActive && !entranceRevealed) || (demoRunning && (demoOpeningPhase === 'rise' || demoOpeningPhase === 'approach'));
  const interact = useCallback(() => { finishEntrance(); onUserInteract(); }, [finishEntrance, onUserInteract]);
  useEffect(() => { if (selectedBin || flat || demoRunning) finishEntrance(); }, [selectedBin, flat, demoRunning, finishEntrance]);
  useEffect(() => {
    pinElapsed.current = 0;
    pin.current.offset = 0;
  }, [selectedBin]);
  useEffect(() => {
    let frame = 0, last = performance.now();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const tick = (now: number) => {
      // Use active time, so backgrounding or the official-records pause cannot jump the bob.
      pinElapsed.current += Math.max(0, Math.min(100, now - last));
      last = now;
      pin.current.offset = pinOffset(pinElapsed.current);
      frame = requestAnimationFrame(tick);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      const disabled = !selectedBin || flat || reduced.matches;
      const moving = !disabled && !demoPaused && !document.hidden;
      if (disabled) pin.current.offset = 0;
      setPinMoving(moving);
      if (moving) {
        last = performance.now();
        pin.current.offset = pinOffset(pinElapsed.current);
        frame = requestAnimationFrame(tick);
      }
    };
    schedule();
    reduced.addEventListener('change', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      cancelAnimationFrame(frame);
      reduced.removeEventListener('change', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [selectedBin, flat, demoPaused]);
  const context = useMemo(() => join.features.filter((f) => !f.properties.prediction), [join]);
  const points = useMemo(
    () => externalMovement ?? movementPoints(join.features, dataMode),
    [externalMovement, join, dataMode],
  );

  // One sun for the whole scene: it lights the geometry and also rakes the façade shader, so the
  // relief in the material falls on the same side as the shading on the massing.
  const sun = useMemo(() => sunState(new Date(), INITIAL_VIEW.latitude, INITIAL_VIEW.longitude), []);

  const effects = useMemo(
    () => [
      new LightingEffect({
        ambient: new AmbientLight({ color: [225, 235, 255], intensity: sun.ambientIntensity }),
        // deck.gl's shadow pass stays off: interleaved with MapLibre it shadows the whole scene and
        // buries the risk colours. The façade shader rakes the same sun vector for relief instead.
        key: new DirectionalLight({ color: [255, 245, 230], intensity: sun.keyIntensity, direction: sun.direction }),
        // Bounce off the sky on the shaded side, so north faces are readable rather than black.
        fill: new DirectionalLight({ color: [165, 200, 255], intensity: 0.35, direction: [sun.toSun[0], sun.toSun[1], -0.4] }),
      }),
    ],
    [sun],
  );

  const layers = useMemo(
    () => [
      movementHexagonLayer(points, showMovement, hexRadius),
      ...buildingRiskLayers({
        context,
        scored: join.scored,
        showRisk,
        grayOpening,
        selectedBin,
        visiblePriorities,
        capacityCutoff,
        rise: rise.current,
        pin: pin.current,
        sun,
        highlight,
      }),
    ],
    [points, showMovement, hexRadius, context, join.scored, showRisk, grayOpening, selectedBin, visiblePriorities, capacityCutoff, sun, highlight],
  );

  const onClick = useCallback(
    (info: PickingInfo) => {
      if (dragged.current) return;
      const f = pickedBuilding(info.object);
      onSelect(f ? f.properties.bin : null);
    },
    [onSelect],
  );

  const getTooltip = useCallback((info: PickingInfo) => {
    const f = pickedBuilding(info.object);
    if (!f) return null;
    const p = f.properties.prediction;
    const head = p ? `#${p.rank} · ${PRIORITY_LABEL[p.priority]}` : 'Not scored · click for history';
    return {
      html: `<div class="tt-rank">${head}</div><div class="tt-addr">${escapeHtml(
        buildingName(f.properties.bin, f.properties.address),
      )}</div>${landmarkFor(f.properties.bin) ? `<div class="tt-address">${escapeHtml(landmarkFor(f.properties.bin)!.address)}</div>` : ''}`,
      className: 'deck-tooltip',
      style: { background: 'none', padding: '0', color: 'inherit' },
    };
  }, []);

  if (!mapStyle) return null;

  return (
    <Map
      ref={ref}
      initialViewState={initialView.current}
      onLoad={() => setReady(true)}
      mapStyle={mapStyle}
      maxPitch={75}
      minZoom={10}
      maxBounds={[-74.35, 40.45, -73.65, 40.95]}
      attributionControl={{ compact: true }}
      dragPan={cameraMode === 'pan' || flat || touch}
      dragRotate={!flat}
      touchPitch={!flat}
      onPitch={(e) => { if (flat && e.viewState.pitch !== 0) e.target.setPitch(0); }}
      onError={(e) => onBasemapError(e.error?.message ?? 'Basemap failed to load')}
      onMouseDown={interact}
      onTouchStart={interact}
      onWheel={interact}
      style={VIEWPORT}
    >
      <NavigationControl position="bottom-right" visualizePitch />
      <SceneEntrance key={demoRunning ? `demo-${demoRunId}` : 'startup'} ready={ready}
        active={startupActive || demoRising} sweepCamera={!demoRunning} transform={rise.current}
        onReveal={revealEntrance}
        onFinish={demoRunning ? finishDemoRise : finishEntrance} />
      <OrbitInteraction enabled={!flat && cameraMode === 'orbit' && !touch} dragged={dragged} />
      <BuildingOrbit enabled={autoOrbit && !flat} subject={selectedBin} />
      <CinematicOverlay interleaved _animate={startupActive || demoRising || pinMoving} layers={layers} effects={effects} onClick={onClick} getTooltip={getTooltip} />
    </Map>
  );
});

/** Left-drag orbit uses public camera methods. Touch and right-drag remain native MapLibre gestures. */
function OrbitInteraction({ enabled, dragged }: { enabled: boolean; dragged: React.MutableRefObject<boolean> }) {
  const { current } = useMap();
  useEffect(() => {
    const map = current?.getMap();
    if (!map) return;
    const canvas = map.getCanvas();
    let start: { x: number; y: number; bearing: number; pitch: number } | null = null;
    const down = (e: MouseEvent) => {
      dragged.current = false;
      if (!enabled || e.button !== 0 || e.ctrlKey || e.metaKey) return;
      start = { x: e.clientX, y: e.clientY, bearing: map.getBearing(), pitch: map.getPitch() };
      map.stop();
    };
    const move = (e: MouseEvent) => {
      if (!start || e.buttons !== 1) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) < 4 && !dragged.current) return;
      dragged.current = true;
      map.jumpTo({ bearing: start.bearing + dx * .28, pitch: Math.min(70, Math.max(10, start.pitch - dy * .22)) });
    };
    const up = () => { start = null; };
    canvas.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);
    return () => {
      canvas.removeEventListener('mousedown', down);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
    };
  }, [current, enabled, dragged]);
  return null;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
