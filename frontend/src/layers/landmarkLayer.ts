import { PathLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { CollisionFilterExtension, type CollisionFilterExtensionProps } from '@deck.gl/extensions';
import type { JoinedFeature } from '../types/predictions';
import { featureCentroid } from '../data/joinByBin';
import { displayHeight, landmarkFor } from '../data/landmarks';
import { oneWtcGeometry, type LandmarkFace, type LandmarkLine } from '../data/landmarkGeometry';

type RGBA = [number, number, number, number];
const geometryCache = new WeakMap<JoinedFeature, ReturnType<typeof oneWtcGeometry>>();
const LABEL_COLLISIONS = new CollisionFilterExtension();

export function landmarkLayers(features: JoinedFeature[], selectedBin: string | null, colorFor: (f: JoinedFeature) => RGBA): Layer[] {
  const landmarks = features.filter((f) => landmarkFor(f.properties.bin));
  const layers: Layer[] = [];
  for (const f of landmarks) {
    if (landmarkFor(f.properties.bin)?.model !== 'one-wtc') continue;
    let geometry = geometryCache.get(f);
    if (!geometry) { geometry = oneWtcGeometry(f); geometryCache.set(f, geometry); }
    const selected = f.properties.bin === selectedBin;
    // A neutral silver-gray landmark is still unscored. Never give it a priority color without a prediction.
    const base: RGBA = !f.properties.prediction ? [110, 133, 154, 255] : colorFor(f);
    layers.push(
      new SolidPolygonLayer<LandmarkFace>({
        id: `landmark-${f.properties.bin}`, data: geometry.faces, _full3d: true,
        getPolygon: (d) => d.polygon, getFillColor: (d) => [Math.min(255, base[0] * d.shade), Math.min(255, base[1] * d.shade), Math.min(255, base[2] * d.shade), 255],
        pickable: true, parameters: { cullMode: 'none' }, updateTriggers: { getFillColor: [base.join(',')] },
      }),
      new PathLayer<LandmarkLine>({
        id: 'landmark-wtc-glazing', data: geometry.glazing, getPath: (d) => d.path,
        getColor: [24, 41, 57, 110], getWidth: 0.28, widthUnits: 'meters', widthMinPixels: 0.25, widthMaxPixels: 0.7,
        pickable: false, getPolygonOffset: () => [-2, -2],
      }),
      new PathLayer<LandmarkLine>({
        id: 'landmark-wtc-edges', data: geometry.edges, getPath: (d) => d.path,
        getColor: selected ? [185, 251, 255, 230] : [170, 193, 211, 155], getWidth: 0.32, widthUnits: 'meters', widthMinPixels: 0.3, widthMaxPixels: 1.1,
        pickable: false, getPolygonOffset: () => [-3, -3],
      }),
      new PathLayer<LandmarkLine>({
        id: 'landmark-wtc-spire', data: geometry.spire, getPath: (d) => d.path,
        getColor: [174, 194, 209, 255], getWidth: (_, { index }) => index === 0 ? 2.4 : 0.45, widthUnits: 'meters', widthMinPixels: 0.5,
        pickable: false,
      }),
    );
  }
  layers.push(new TextLayer<JoinedFeature, CollisionFilterExtensionProps<JoinedFeature>>({
    id: 'landmark-names', data: landmarks,
    getPosition: (f) => [...featureCentroid(f), displayHeight(f) + 18],
    getText: (f) => landmarkFor(f.properties.bin)!.name,
    getSize: 11, sizeUnits: 'pixels', getColor: [237, 237, 226, 255],
    // Keep the collision anchor inside the label, with extra spacing at dense zooms.
    getTextAnchor: 'middle', getAlignmentBaseline: 'center', getPixelOffset: [0, 0],
    fontFamily: 'Arial, sans-serif', fontWeight: 500, outlineWidth: 1, outlineColor: [18, 26, 22, 255],
    fontSettings: { sdf: true }, billboard: true, pickable: true,
    characterSet: 'auto', extensions: [LABEL_COLLISIONS], collisionEnabled: true,
    collisionTestProps: { sizeScale: 1.6 },
    getCollisionPriority: (f) => f.properties.bin === selectedBin ? 1000 : displayHeight(f),
    updateTriggers: { getCollisionPriority: [selectedBin] },
    background: true, getBackgroundColor: [18, 26, 22, 235], backgroundPadding: [7, 5],
    parameters: { depthWriteEnabled: false },
  }));
  return layers;
}

/** Polygon faces and text labels resolve to the same BIN-based selection as normal footprints. */
export function pickedBuilding(object: unknown): JoinedFeature | undefined {
  if (!object || typeof object !== 'object') return undefined;
  const value = object as JoinedFeature & { feature?: JoinedFeature };
  return value.feature ?? (value.type === 'Feature' && value.properties?.bin ? value : undefined);
}
