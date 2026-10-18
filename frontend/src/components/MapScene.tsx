import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import Map, { NavigationControl, useControl, type MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';
import type { PickingInfo } from '@deck.gl/core';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { DataMode, JoinedFeature, JoinResult, Priority } from '../types/predictions';
import { buildingRiskLayers } from '../layers/buildingRiskLayer';
import { movementHexagonLayer, movementPoints, type MovementPointDatum } from '../layers/movementHexagonLayer';
import { PRIORITY_LABEL } from '../data/priority';
import { DEMO_BBOX, INITIAL_VIEW } from '../camera';

export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

const [W, S, E, N] = DEMO_BBOX;
const DEMO_AREA_POLYGON = {
  type: 'Polygon' as const,
  coordinates: [[[W, S], [E, S], [E, N], [W, N], [W, S]]],
};

/** Dark background-only style used if the basemap cannot be fetched; the scored overlay still renders. */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#070a12' } }],
};

/**
 * Adapt the OpenFreeMap dark style: drop sprite-pattern fills it does not ship, hide its flat
 * building fills and add generic 3D context buildings outside the scored demo area.
 */
export function adaptBasemapStyle(style: StyleSpecification): StyleSpecification {
  const vectorSource = Object.entries(style.sources).find(([, s]) => s.type === 'vector')?.[0];
  const layers = style.layers
    .filter((l) => !(l.type === 'fill' && l.paint && 'fill-pattern' in l.paint))
    .map((l) =>
      'source-layer' in l && l['source-layer'] === 'building' ? { ...l, layout: { ...l.layout, visibility: 'none' as const } } : l,
    );
  if (vectorSource) {
    const firstSymbol = layers.findIndex((l) => l.type === 'symbol');
    layers.splice(firstSymbol < 0 ? layers.length : firstSymbol, 0, {
      id: 'context-3d-buildings',
      source: vectorSource,
      'source-layer': 'building',
      type: 'fill-extrusion',
      minzoom: 12,
      filter: ['!', ['within', DEMO_AREA_POLYGON]],
      paint: {
        'fill-extrusion-color': '#1a2030',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.9,
      },
    });
  }
  return { ...style, layers };
}

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

  // Gentle pulse for the selection beacon; stops when nothing is selected.
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (!selectedBin) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      setPulse((Math.sin(((t - start) / 1400) * Math.PI * 2) + 1) / 2);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectedBin]);

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
        pulse,
        highlight,
      }),
    ],
    [points, showMovement, hexRadius, context, join.scored, showRisk, selectedBin, visiblePriorities, capacityCutoff, pulse, highlight],
  );

  const onClick = useCallback(
    (info: PickingInfo) => {
      const f = info.object as JoinedFeature | undefined;
      onSelect(f ? f.properties.bin : null);
    },
    [onSelect],
  );

  const getTooltip = useCallback((info: PickingInfo) => {
    const f = info.object as JoinedFeature | undefined;
    if (!f) return null;
    const p = f.properties.prediction;
    const head = p ? `#${p.rank} · ${PRIORITY_LABEL[p.priority]}` : 'Not scored · click for history';
    return {
      html: `<div class="tt-rank">${head}</div><div class="tt-addr">${escapeHtml(
        f.properties.address ?? `BIN ${f.properties.bin}`,
      )}</div>`,
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
      style={{ position: 'absolute', inset: 0 }}
    >
      <NavigationControl position="bottom-right" visualizePitch />
      <DeckGLOverlay interleaved layers={layers} onClick={onClick} getTooltip={getTooltip} />
    </Map>
  );
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
