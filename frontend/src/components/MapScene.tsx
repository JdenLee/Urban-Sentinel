import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import Map, { NavigationControl, type MapRef } from 'react-map-gl/maplibre';
import { AmbientLight, DirectionalLight, LightingEffect, type PickingInfo } from '@deck.gl/core';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { DataMode, JoinedFeature, JoinResult, Priority } from '../types/predictions';
import { buildingRiskLayers } from '../layers/buildingRiskLayer';
import { movementHexagonLayer, movementPoints, type MovementPointDatum } from '../layers/movementHexagonLayer';
import { PRIORITY_LABEL } from '../data/priority';
import { INITIAL_VIEW } from '../camera';
import { adaptBasemapStyle } from '../data/basemapStyle';
import { CinematicOverlay } from './CinematicOverlay';
import { buildingName, landmarkFor } from '../data/landmarks';
import { pickedBuilding } from '../layers/landmarkLayer';

export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/** Dark background-only style used if the basemap cannot be fetched; the scored overlay still renders. */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#070a12' } }],
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
  },
  ref,
) {
  const mapStyle = useBasemapStyle(onBasemapError);
  const context = useMemo(() => join.features.filter((f) => !f.properties.prediction), [join]);
  const points = useMemo(
    () => externalMovement ?? movementPoints(join.features, dataMode),
    [externalMovement, join, dataMode],
  );

  const effects = useMemo(() => [new LightingEffect({
    ambient: new AmbientLight({ color: [225, 235, 255], intensity: 1.0 }),
    key: new DirectionalLight({ color: [255, 245, 230], intensity: 1.0, direction: [-3, -5, -4] }),
    fill: new DirectionalLight({ color: [165, 200, 255], intensity: 0.35, direction: [3, 1, -2] }),
  })], []);

  const layers = useMemo(
    () => [
      movementHexagonLayer(points, showMovement, hexRadius),
      ...buildingRiskLayers({
        context,
        scored: join.scored,
        showRisk,
        selectedBin,
        visiblePriorities,
        capacityCutoff,
        pulse: 0.4,
        highlight,
      }),
    ],
    [points, showMovement, hexRadius, context, join.scored, showRisk, selectedBin, visiblePriorities, capacityCutoff, highlight],
  );

  const onClick = useCallback(
    (info: PickingInfo) => {
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
      initialViewState={INITIAL_VIEW}
      mapStyle={mapStyle}
      maxPitch={75}
      minZoom={10}
      maxBounds={[-74.35, 40.45, -73.65, 40.95]}
      attributionControl={{ compact: true }}
      onError={(e) => onBasemapError(e.error?.message ?? 'Basemap failed to load')}
      onMouseDown={onUserInteract}
      onTouchStart={onUserInteract}
      onWheel={onUserInteract}
      onMoveStart={(e) => { if (e.originalEvent) onUserInteract(); }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <NavigationControl position="bottom-right" visualizePitch />
      <CinematicOverlay interleaved layers={layers} effects={effects} onClick={onClick} getTooltip={getTooltip} />
    </Map>
  );
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
