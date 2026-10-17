import { GEOSEARCH_URL } from '../config';
import { binString } from './loadPredictions';

/** One NYC address suggestion, keyed by the building's BIN. */
export interface AddressMatch {
  label: string;
  bin: string;
  borough: string | null;
  lonLat: [number, number] | null;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** DOB "million BINs" (1000000, 2000000, …) are placeholders, not buildings. */
const isPlaceholderBin = (bin: string) => /^[1-5]000000$/.test(bin);

/**
 * Parse a GeoSearch v2 response (GeoJSON FeatureCollection; BIN in properties.addendum.pad.bin).
 * Drops results without a usable BIN and keeps one suggestion per building.
 */
export function parseGeosearch(raw: unknown, limit = 6): AddressMatch[] {
  if (!isObj(raw) || !Array.isArray(raw.features)) return [];
  const seen = new Set<string>();
  const out: AddressMatch[] = [];
  for (const f of raw.features) {
    if (!isObj(f) || !isObj(f.properties)) continue;
    const p = f.properties;
    const pad = isObj(p.addendum) && isObj(p.addendum.pad) ? p.addendum.pad : {};
    const bin = binString(typeof pad.bin === 'number' ? pad.bin : String(pad.bin ?? ''));
    if (!bin || isPlaceholderBin(bin) || seen.has(bin)) continue;
    const coords = isObj(f.geometry) && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : null;
    const lonLat =
      coords && typeof coords[0] === 'number' && typeof coords[1] === 'number'
        ? ([coords[0], coords[1]] as [number, number])
        : null;
    const label = (typeof p.label === 'string' ? p.label : typeof p.name === 'string' ? p.name : bin)
      .replace(/, NY, USA$/, '')
      .trim();
    seen.add(bin);
    out.push({ label, bin, borough: typeof p.borough === 'string' ? p.borough : null, lonLat });
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchAddresses(text: string, signal?: AbortSignal): Promise<AddressMatch[]> {
  const res = await fetch(`${GEOSEARCH_URL}?text=${encodeURIComponent(text)}`, { signal });
  if (!res.ok) throw new Error(`Address search failed: HTTP ${res.status}`);
  return parseGeosearch(await res.json());
}
