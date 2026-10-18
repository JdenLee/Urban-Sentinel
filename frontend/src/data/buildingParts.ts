import type { JoinedFeature } from '../types/predictions';
import { DEFAULT_HEIGHT_M } from './joinByBin';

/** Expand only the render geometry; search, ranking and selection keep one canonical BIN. */
export function renderParts(feature: JoinedFeature): JoinedFeature[] {
  const parts = feature.properties.parts;
  if (!parts?.length) return [feature];
  return parts.map((part) => ({
    ...feature,
    geometry: part.geometry,
    properties: { ...feature.properties, height_m: part.height_m ?? DEFAULT_HEIGHT_M, height_estimated: part.height_m === null },
  }));
}
