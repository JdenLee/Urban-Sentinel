import { GeoJsonLayer, ColumnLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { JoinedFeature } from '../types/predictions';
import { PRIORITY_COLOR, SELECTED_COLOR, UNSCORED_COLOR } from '../data/priority';
import { featureCentroid } from '../data/joinByBin';

type RGBA = [number, number, number, number];

const CONTEXT_FILL: RGBA = [...UNSCORED_COLOR, 255];
const SCORED_NEUTRAL: RGBA = [96, 104, 122, 255];
const COLOR_TRANSITION_MS = 1600;

const MATERIAL = { ambient: 0.45, diffuse: 0.6, shininess: 24, specularColor: [70, 80, 110] as [number, number, number] };

export interface BuildingLayerOptions {
  context: JoinedFeature[];
  scored: JoinedFeature[];
  showRisk: boolean;
  selectedBin: string | null;
  /** 0..1 pulse phase for the selection beacon. */
  pulse: number;
}

function riskColor(f: JoinedFeature, showRisk: boolean, selectedBin: string | null): RGBA {
  const p = f.properties.prediction;
  if (f.properties.bin === selectedBin) return [...SELECTED_COLOR, 255];
  if (!p || !showRisk) return SCORED_NEUTRAL;
  return [...PRIORITY_COLOR[p.priority], 255];
}

/**
 * Three layers:
 *  - context: every unscored demo footprint, static muted gray (not pickable, never re-coloured)
 *  - scored: buildings with predictions, coloured by priority with a gray → colour transition
 *  - selection: wireframe shell plus a light beam above the selected building
 */
export function buildingRiskLayers({ context, scored, showRisk, selectedBin, pulse }: BuildingLayerOptions): Layer[] {
  const layers: Layer[] = [
    new GeoJsonLayer<JoinedFeature['properties']>({
      id: 'context-buildings',
      data: context,
      extruded: true,
      filled: true,
      stroked: false,
      getElevation: (f) => f.properties.height_m,
      getFillColor: CONTEXT_FILL,
      material: MATERIAL,
      pickable: false,
    }),
    new GeoJsonLayer<JoinedFeature['properties']>({
      id: 'scored-buildings',
      data: scored,
      extruded: true,
      filled: true,
      stroked: false,
      getElevation: (f) => f.properties.height_m,
      getFillColor: (f) => riskColor(f as JoinedFeature, showRisk, selectedBin),
      material: MATERIAL,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 70],
      updateTriggers: { getFillColor: [showRisk, selectedBin] },
      transitions: { getFillColor: { duration: COLOR_TRANSITION_MS, type: 'interpolation' } },
    }),
  ];

  const selected = selectedBin ? scored.find((f) => f.properties.bin === selectedBin) : undefined;
  if (selected) {
    const top = selected.properties.height_m;
    layers.push(
      new GeoJsonLayer<JoinedFeature['properties']>({
        id: 'selected-shell',
        data: [selected],
        extruded: true,
        wireframe: true,
        filled: false,
        getElevation: top + 1.5,
        getLineColor: [210, 255, 255, 255],
        pickable: false,
      }),
      new ColumnLayer<{ position: [number, number] }>({
        id: 'selected-beacon',
        data: [{ position: featureCentroid(selected) }],
        diskResolution: 24,
        radius: 4 + 3 * pulse,
        extruded: true,
        getPosition: (d) => [d.position[0], d.position[1], top],
        getElevation: 260,
        getFillColor: [150, 255, 255, Math.round(70 + 60 * (1 - pulse))],
        material: false,
        pickable: false,
        parameters: { depthWriteEnabled: false },
      }),
    );
  }
  return layers;
}
