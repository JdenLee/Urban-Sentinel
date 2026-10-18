import { DEFAULT_MATERIAL } from './facadeMaterials';
import type { BuildingCollection, JoinResult, JoinedFeature, PredictionSet } from '../types/predictions';

/** Used when a footprint has no roof height; roughly a four-storey walk-up. */
export const DEFAULT_HEIGHT_M = 12;

/** Join footprints to predictions on BIN (string equality). Unscored footprints keep `prediction: null`. */
export function joinByBin(buildings: BuildingCollection, predictions: PredictionSet): JoinResult {
  const byBin = new Map(predictions.buildings.map((p) => [String(p.bin), p]));
  const matched = new Set<string>();

  const features: JoinedFeature[] = buildings.features.map((f) => {
    const bin = String(f.properties.bin);
    const prediction = byBin.get(bin) ?? null;
    if (prediction) matched.add(bin);
    const h = f.properties.height_m;
    const hasHeight = typeof h === 'number' && Number.isFinite(h) && h > 0;
    return {
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        ...f.properties,
        bin,
        address: prediction?.address ?? f.properties.address ?? null,
        height_m: hasHeight ? h : DEFAULT_HEIGHT_M,
        height_estimated: !hasHeight,
        material: f.properties.material ?? DEFAULT_MATERIAL,
        material_source: f.properties.material_source ?? 'inferred',
        prediction,
      },
    };
  });

  const scored = features
    .filter((f) => f.properties.prediction)
    .sort((a, b) => a.properties.prediction!.rank - b.properties.prediction!.rank);
  const unmatchedPredictions = predictions.buildings.filter((p) => !matched.has(p.bin));
  return { features, scored, unmatchedPredictions };
}

/** Approximate centroid (vertex mean of the outer ring) for camera targets and point layers. */
export function featureCentroid(f: JoinedFeature): [number, number] {
  const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring;
  let x = 0, y = 0;
  for (const [lon, lat] of pts) {
    x += lon;
    y += lat;
  }
  return [x / pts.length, y / pts.length];
}
