import { PathLayer, SolidPolygonLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { JoinedFeature } from '../types/predictions';
import { landmarkFor } from '../data/landmarks';
import { oneWtcGeometry, setbackGeometry, type LandmarkFace, type LandmarkLine } from '../data/landmarkGeometry';
import { SELECTED_COLOR } from '../data/priority';

type RGBA = [number, number, number, number];
const geometryCache = new WeakMap<JoinedFeature, ReturnType<typeof oneWtcGeometry>>();

export function landmarkLayers(features: JoinedFeature[], selectedBin: string | null, colorFor: (f: JoinedFeature) => RGBA): Layer[] {
  const landmarks = features.filter((f) => landmarkFor(f.properties.bin));
  const layers: Layer[] = [];
  for (const f of landmarks) {
    const kind = landmarkFor(f.properties.bin)?.model;
    if (!kind) continue;
    let geometry = geometryCache.get(f);
    if (!geometry) { geometry = kind === 'one-wtc' ? oneWtcGeometry(f) : setbackGeometry(f, kind); geometryCache.set(f, geometry); }
    const selected = f.properties.bin === selectedBin;
    // A neutral silver-gray landmark is still unscored. Never give it a priority color without a prediction.
    const base: RGBA = selected ? [...SELECTED_COLOR, 255] : !f.properties.prediction ? kind === 'one-wtc' ? [147, 167, 177, 255] : [199, 190, 167, 255] : colorFor(f);
    layers.push(
      new SolidPolygonLayer<LandmarkFace>({
        id: `landmark-${f.properties.bin}`, data: geometry.faces, _full3d: true,
        getPolygon: (d) => d.polygon, getFillColor: (d) => {
          const c = d.crown && !selected && !f.properties.prediction ? [104, 143, 129] : base;
          return [Math.min(255, c[0] * d.shade), Math.min(255, c[1] * d.shade), Math.min(255, c[2] * d.shade), 255];
        },
        pickable: true, parameters: { cullMode: 'none' }, updateTriggers: { getFillColor: [base.join(',')] },
      }),
      new PathLayer<LandmarkLine>({
        id: `landmark-${f.properties.bin}-glazing`, data: geometry.glazing, getPath: (d) => d.path,
        getColor: [24, 41, 57, 110], getWidth: 0.28, widthUnits: 'meters', widthMinPixels: 0.25, widthMaxPixels: 0.7,
        pickable: false, getPolygonOffset: () => [-2, -2],
      }),
      new PathLayer<LandmarkLine>({
        id: `landmark-${f.properties.bin}-edges`, data: geometry.edges, getPath: (d) => d.path,
        getColor: selected ? [35, 76, 80, 255] : [140, 153, 151, 155], getWidth: 0.32, widthUnits: 'meters', widthMinPixels: 0.3, widthMaxPixels: 1.1,
        pickable: false, getPolygonOffset: () => [-3, -3],
      }),
      new PathLayer<LandmarkLine>({
        id: `landmark-${f.properties.bin}-spire`, data: geometry.spire, getPath: (d) => d.path,
        getColor: [174, 194, 209, 255], getWidth: (_, { index }) => index === 0 ? 2.4 : 0.45, widthUnits: 'meters', widthMinPixels: 0.5,
        pickable: false,
      }),
    );
  }

  return layers;
}

/** Polygon faces and text labels resolve to the same BIN-based selection as normal footprints. */
export function pickedBuilding(object: unknown): JoinedFeature | undefined {
  if (!object || typeof object !== 'object') return undefined;
  const value = object as JoinedFeature & { feature?: JoinedFeature };
  return value.feature ?? (value.type === 'Feature' && value.properties?.bin ? value : undefined);
}
