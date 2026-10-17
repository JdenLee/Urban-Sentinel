import { GROUND_MOTION_SOURCES } from '../config';
import type { MovementPointDatum } from '../layers/movementHexagonLayer';

export interface GroundMotionLayer {
  points: MovementPointDatum[];
  metadata: Record<string, unknown>;
  url: string;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parse the quality-filtered NASA OPERA DISP-S1 export (ml/insar/export_map_layer.py). Only real measured
 * points are returned: features without a finite velocity are dropped, nothing is interpolated.
 */
export function parseGroundMotion(raw: unknown): Omit<GroundMotionLayer, 'url'> | null {
  if (!isObj(raw) || !Array.isArray(raw.features)) return null;
  const points: MovementPointDatum[] = [];
  for (const f of raw.features) {
    if (!isObj(f) || !isObj(f.geometry) || !isObj(f.properties)) continue;
    const c = f.geometry.coordinates;
    const v = f.properties.velocity_mm_yr;
    if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    points.push({ position: [c[0], c[1]], speed: Math.abs(v) });
  }
  return points.length ? { points, metadata: isObj(raw.metadata) ? raw.metadata : {} } : null;
}

/** First available source (live API, then committed file); null when no real layer exists. */
export async function loadGroundMotion(signal?: AbortSignal, urls = GROUND_MOTION_SOURCES): Promise<GroundMotionLayer | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) continue;
      const parsed = parseGroundMotion(await res.json());
      if (parsed) return { ...parsed, url };
    } catch {
      if (signal?.aborted) return null;
    }
  }
  return null;
}
