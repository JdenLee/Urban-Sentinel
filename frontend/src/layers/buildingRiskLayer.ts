import { GeoJsonLayer, LineLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { GeoJsonLayerProps } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { JoinedFeature, Priority } from '../types/predictions';
import { FILTERED_COLOR, PRIORITY_COLOR, SELECTED_COLOR, UNSCORED_COLOR } from '../data/priority';
import { landmarkFor } from '../data/landmarks';
import { materialIndex, storeyHeight } from '../data/facadeMaterials';
import type { SunState } from '../data/sunPosition';
import { FACADE_MATERIAL } from './FacadeMaterialExtension';
import { landmarkLayers } from './landmarkLayer';
import { renderParts } from '../data/buildingParts';
import { geometryCenter } from '../data/buildingImagery';
import { SCENE_TRANSFORM } from './SceneTransformExtension';
import { CITY_COLOR_FADE_MS, CITY_OPENING_GRAY, smoothstep, type SceneTransform } from '../motion/sceneMotion';

type RGBA = [number, number, number, number];

const CONTEXT_FILL: RGBA = [...UNSCORED_COLOR, 255];
const SCORED_NEUTRAL: RGBA = [182, 179, 168, 255];

const MATERIAL = { ambient: 0.45, diffuse: 0.6, shininess: 24, specularColor: [70, 80, 110] as [number, number, number] };
const ordinaryCache = new WeakMap<JoinedFeature[], JoinedFeature[]>();

/**
 * Procedural façade material, shared by every extruded body. deck.gl's layer prop types do not
 * include extension props, so they are cast in once here rather than at each use.
 */
function facadeProps(sun: SunState, sceneTransform: SceneTransform, grayOpening: boolean): Partial<GeoJsonLayerProps<JoinedFeature['properties']>> {
  return {
    extensions: [FACADE_MATERIAL, SCENE_TRANSFORM],
    sceneTransform,
    // Per building: material class, storey spacing in metres, roof height in metres.
    getFacadeParams: (f: JoinedFeature) => {
      const { height_m, floors, material } = f.properties;
      return [materialIndex(material), storeyHeight(height_m, floors, material), height_m];
    },
    facadeSun: sun.toSun,
    facadeSky: sun.sky,
    facadeNight: sun.night,
    // Keep material tints and lit windows out of the gray opening.
    facadeDetail: grayOpening ? 0 : 1,
  } as Partial<GeoJsonLayerProps<JoinedFeature['properties']>>;
}

function ordinaryBuildings(features: JoinedFeature[]): JoinedFeature[] {
  let ordinary = ordinaryCache.get(features);
  if (!ordinary) {
    ordinary = features.filter((f) => !landmarkFor(f.properties.bin)?.model).flatMap(renderParts);
    ordinaryCache.set(features, ordinary);
  }
  return ordinary;
}

export interface BuildingLayerOptions {
  context: JoinedFeature[];
  scored: JoinedFeature[];
  showRisk: boolean;
  grayOpening?: boolean;
  selectedBin: string | null;
  /** Categories shown in colour; others render as filtered gray. */
  visiblePriorities: Set<Priority>;
  /** When set, only buildings ranked within this capacity keep their colour. */
  capacityCutoff: number | null;
  rise: SceneTransform;
  pin: SceneTransform;
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
  if (o.grayOpening) return CITY_OPENING_GRAY;
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
  const { context, scored, showRisk, selectedBin, visiblePriorities, capacityCutoff, sun, highlight, grayOpening = false } = options;
  const filterKey = [...visiblePriorities].sort().join(',');
  const facade = facadeProps(sun, options.rise, grayOpening);
  // A one-frame reset keeps deck.gl's existing transition buffers valid on replay.
  // A zero-duration GPU transition can leave the old colour buffer unbound.
  const colorTransition = { duration: grayOpening ? 1 : CITY_COLOR_FADE_MS, type: 'interpolation' as const, easing: smoothstep };
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
        if (grayOpening) return CITY_OPENING_GRAY;
        if (f.properties.bin === selectedBin) return [...SELECTED_COLOR, 255];
        return CONTEXT_FILL;
      },
      material: MATERIAL,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 40],
      updateTriggers: { getFillColor: [selectedBin, showRisk, grayOpening] },
      transitions: { getFillColor: colorTransition },
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
      updateTriggers: { getFillColor: [showRisk, selectedBin, filterKey, capacityCutoff, grayOpening] },
      transitions: { getFillColor: colorTransition },
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
    layers.push(
      new GeoJsonLayer<JoinedFeature['properties']>({
        id: 'selected-shell',
        data: renderParts(selected),
        extruded: true,
        wireframe: true,
        filled: false,
        getElevation: (f) => f.properties.height_m + 0.6,
        getLineColor: [35, 76, 80, 255],
        pickable: false,
      }),
    );
  }
  layers.push(...landmarkLayers([...context, ...scored], selectedBin, (f) => riskColor(f, options), options.rise, grayOpening));
  if (selected) {
    const center = geometryCenter(selected.geometry);
    const height = landmarkFor(selected.properties.bin)?.architecturalHeight ?? selected.properties.height_m;
    if (center) {
      const top: [number, number, number] = [...center, height + 24];
      const overlay = { pickable: false,
        parameters: { depthCompare: 'always' as const, depthWriteEnabled: false } };
      const motion = { ...overlay, extensions: [SCENE_TRANSFORM], sceneTransform: options.pin };
      // Keep the axis grounded while the ringed roof marker drops, settles and gently hovers.
      layers.push(
        new LineLayer({ id: 'selection-axis-halo', data: [center], getSourcePosition: [...center, 1], getTargetPosition: top,
          getColor: [255, 255, 255, 230], getWidth: 4, ...overlay }),
        new LineLayer({ id: 'selection-axis', data: [center], getSourcePosition: [...center, 1], getTargetPosition: top,
          getColor: [13, 99, 106, 255], getWidth: 2, ...overlay }),
        new ScatterplotLayer({ id: 'selection-pin-ring', data: [center], getPosition: top, radiusUnits: 'pixels', getRadius: 12,
          stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 1.5,
          getLineColor: [13, 99, 106, 160], billboard: true, ...motion }),
        new ScatterplotLayer({ id: 'selection-pin', data: [center], getPosition: top, radiusUnits: 'pixels', getRadius: 7,
          stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2, getLineColor: [255, 255, 255, 255],
          getFillColor: [13, 99, 106, 255], billboard: true, ...motion }),
      );
    }
  }
  return layers;
}
