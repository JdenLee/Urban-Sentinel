import { GeoJsonLayer, ColumnLayer } from '@deck.gl/layers';
import type { GeoJsonLayerProps } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { JoinedFeature, Priority } from '../types/predictions';
import { FILTERED_COLOR, PRIORITY_COLOR, RECORDED_COLOR, SELECTED_COLOR, UNSCORED_COLOR } from '../data/priority';
import { featureCentroid } from '../data/joinByBin';
import { landmarkFor } from '../data/landmarks';
import { materialIndex, storeyHeight } from '../data/facadeMaterials';
import type { SunState } from '../data/sunPosition';
import { FACADE_MATERIAL } from './FacadeMaterialExtension';
import { landmarkLayers } from './landmarkLayer';

type RGBA = [number, number, number, number];

const CONTEXT_FILL: RGBA = [...UNSCORED_COLOR, 255];
const SCORED_NEUTRAL: RGBA = [96, 104, 122, 255];
const COLOR_TRANSITION_MS = 1600;

const MATERIAL = { ambient: 0.45, diffuse: 0.6, shininess: 24, specularColor: [70, 80, 110] as [number, number, number] };
const ordinaryCache = new WeakMap<JoinedFeature[], JoinedFeature[]>();

/**
 * Procedural façade material, shared by every extruded body. deck.gl's layer prop types do not
 * include extension props, so they are cast in once here rather than at each use.
 */
function facadeProps(sun: SunState): Partial<GeoJsonLayerProps<JoinedFeature['properties']>> {
  return {
    extensions: [FACADE_MATERIAL],
    // Per building: material class, storey spacing in metres, roof height in metres.
    getFacadeParams: (f: JoinedFeature) => {
      const { height_m, floors, material } = f.properties;
      return [materialIndex(material), storeyHeight(height_m, floors, material), height_m];
    },
    facadeSun: sun.toSun,
    facadeSky: sun.sky,
    facadeNight: sun.night,
  } as Partial<GeoJsonLayerProps<JoinedFeature['properties']>>;
}

function ordinaryBuildings(features: JoinedFeature[]): JoinedFeature[] {
  let ordinary = ordinaryCache.get(features);
  if (!ordinary) {
    ordinary = features.filter((f) => !landmarkFor(f.properties.bin)?.model);
    ordinaryCache.set(features, ordinary);
  }
  return ordinary;
}

export interface BuildingLayerOptions {
  context: JoinedFeature[];
  scored: JoinedFeature[];
  showRisk: boolean;
  selectedBin: string | null;
  /** Categories shown in colour; others render as filtered gray. */
  visiblePriorities: Set<Priority>;
  /** When set, only buildings ranked within this capacity keep their colour. */
  capacityCutoff: number | null;
  /** 0..1 pulse phase for the selection beacon. */
  pulse: number;
  /** Key light and sky, shared by the lighting effect and the façade shader. */
  sun: SunState;
  /**
   * Selected building that is not a scored footprint: a context footprint, or one fetched for a looked-up
   * address outside the demo area (`external`; drawn as its own body because the scene has no footprint).
   */
  highlight?: { feature: JoinedFeature; external: boolean } | null;
}

const FILTERED: RGBA = [...FILTERED_COLOR, 255];

function riskColor(f: JoinedFeature, o: BuildingLayerOptions): RGBA {
  const p = f.properties.prediction;
  if (f.properties.bin === o.selectedBin) return [...SELECTED_COLOR, 255];
  if (!p || !o.showRisk) return SCORED_NEUTRAL;
  if (!o.visiblePriorities.has(p.priority)) return FILTERED;
  if (o.capacityCutoff !== null && p.rank > o.capacityCutoff) return FILTERED;
  return [...PRIORITY_COLOR[p.priority], 255];
}

/**
 * Layers:
 *  - context: every unscored demo footprint, muted gray; pickable so any building can open its history
 *  - scored: buildings with predictions, coloured by priority with a gray → colour transition
 *  - external highlight: a looked-up building outside the demo area, drawn in the selection colour
 *  - selection: wireframe shell plus a light beam above the selected building
 */
export function buildingRiskLayers(options: BuildingLayerOptions): Layer[] {
  const { context, scored, showRisk, selectedBin, visiblePriorities, capacityCutoff, pulse, sun, highlight } = options;
  const filterKey = [...visiblePriorities].sort().join(',');
  const facade = facadeProps(sun);
  const layers: Layer[] = [
    new GeoJsonLayer<JoinedFeature['properties']>({
      id: 'context-buildings',
      data: ordinaryBuildings(context),
      ...facade,
      extruded: true,
      filled: true,
      stroked: false,
      getElevation: (f) => f.properties.height_m,
      getFillColor: (f) => {
        if (f.properties.bin === selectedBin) return [...SELECTED_COLOR, 255];
        const rec = showRisk ? f.properties.recorded : null;
        const c = rec ? RECORDED_COLOR[rec.status] : undefined;
        return c ? [...c, 255] : CONTEXT_FILL;
      },
      material: MATERIAL,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 40],
      updateTriggers: { getFillColor: [selectedBin, showRisk] },
    }),
    new GeoJsonLayer<JoinedFeature['properties']>({
      id: 'scored-buildings',
      data: ordinaryBuildings(scored),
      ...facade,
      extruded: true,
      filled: true,
      stroked: false,
      getElevation: (f) => f.properties.height_m,
      getFillColor: (f) => riskColor(f as JoinedFeature, options),
      material: MATERIAL,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 70],
      updateTriggers: { getFillColor: [showRisk, selectedBin, filterKey, capacityCutoff] },
      transitions: { getFillColor: { duration: COLOR_TRANSITION_MS, type: 'interpolation' } },
    }),
  ];

  if (highlight?.external) {
    layers.push(
      new GeoJsonLayer<JoinedFeature['properties']>({
        id: 'external-highlight',
        data: [highlight.feature],
        ...facade,
        extruded: true,
        filled: true,
        stroked: false,
        getElevation: highlight.feature.properties.height_m + 1,
        getFillColor: [...SELECTED_COLOR, 255],
        material: MATERIAL,
        pickable: false,
      }),
    );
  }

  const selected =
    (selectedBin ? scored.find((f) => f.properties.bin === selectedBin) : undefined) ?? highlight?.feature;
  if (selected && !landmarkFor(selected.properties.bin)?.model) {
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
        radius: 3.5 + 1.5 * pulse,
        extruded: true,
        getPosition: (d) => [d.position[0], d.position[1], top],
        getElevation: 140,
        getFillColor: [160, 240, 255, Math.round(40 + 20 * (1 - pulse))],
        material: false,
        pickable: false,
        parameters: { depthWriteEnabled: false },
      }),
    );
  }
  layers.push(...landmarkLayers([...context, ...scored], selectedBin, (f) => riskColor(f, options)));
  return layers;
}
