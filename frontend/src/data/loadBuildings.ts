import type { BuildingCollection, BuildingFeature } from '../types/predictions';
import { isFacadeMaterial } from './facadeMaterials';
import { binString } from './loadPredictions';

export const BUILDINGS_URL = `${import.meta.env.BASE_URL}data/buildings-demo.geojson`;

/** Validate the prepared footprint file and coerce every BIN to a string. */
export function parseBuildings(raw: unknown): BuildingCollection {
  const fc = raw as { type?: string; features?: unknown[] };
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new Error('Building file must be a GeoJSON FeatureCollection.');
  }
  const features: BuildingFeature[] = [];
  for (const f of fc.features as BuildingFeature[]) {
    const type = f?.geometry?.type;
    if (type !== 'Polygon' && type !== 'MultiPolygon') continue;
    const bin = binString(f.properties?.bin);
    if (!bin) continue;
    const h = Number(f.properties.height_m);
    const floors = Number(f.properties.floors);
    const material = f.properties.material;
    features.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        bin,
        address: typeof f.properties.address === 'string' ? f.properties.address : null,
        height_m: Number.isFinite(h) && h > 0 ? h : null,
        year_built: f.properties.year_built ?? null,
        floors: Number.isFinite(floors) && floors > 0 ? floors : null,
        material: isFacadeMaterial(material) ? material : null,
        material_source: f.properties.material_source === 'filing' ? 'filing' : 'inferred',
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export async function loadBuildings(url = BUILDINGS_URL, signal?: AbortSignal): Promise<BuildingCollection> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Could not load building footprints (${url}): HTTP ${res.status}`);
  return parseBuildings(await res.json());
}
