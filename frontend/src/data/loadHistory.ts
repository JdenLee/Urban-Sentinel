import { API_BASE, FOOTPRINTS_URL } from '../config';
import type { BuildingFeature, BuildingHistory, HistoryRecord, MovementSeriesMeta } from '../types/predictions';
import { binString, mlRecordToPrediction, parseMovement, parseSources } from './loadPredictions';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Record categories used for the History tab's filter chips, in display order. */
export const RECORD_TYPES = ['FISP filing', 'DOB violation', 'ECB violation', '311 complaint'] as const;

export class HistoryUnavailableError extends Error {
  constructor() {
    super('Building history needs the ML API (set VITE_API_URL).');
  }
}

function parseHistoryRecords(raw: unknown): HistoryRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((r) => ({
      date: str(r.date),
      type: str(r.type) ?? 'Record',
      description: str(r.description) ?? '',
      status: str(r.status),
      cycle: num(r.cycle),
      reference: str(r.reference),
    }))
    .filter((r) => r.description || r.date)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

function parseMovementBlock(raw: unknown): BuildingHistory['movement'] {
  if (!isObj(raw)) return null;
  const points = parseMovement(raw.series);
  if (points.length < 2) return null;
  const m = isObj(raw.meta) ? raw.meta : {};
  const meta: MovementSeriesMeta = {
    measurement: str(m.measurement) ?? 'Line-of-sight (LOS) displacement',
    units: str(m.units) ?? 'mm',
    source: str(m.source),
    period_start: str(m.period_start),
    period_end: str(m.period_end),
    baseline_label: str(m.baseline_label),
    sign: str(m.sign),
    note: str(m.note),
  };
  return { meta, points, velocityHp: num(raw.velocity_hp2km_mm_yr) };
}

/** Validate a GET /buildings/{bin}/history payload. */
export function parseHistory(raw: unknown): BuildingHistory {
  if (!isObj(raw)) throw new Error('History response is not an object.');
  const bin = binString(raw.bin);
  if (!bin) throw new Error('History response has no valid BIN.');
  const rec = isObj(raw.record) ? raw.record : null;
  const fisp = rec && isObj(rec.fisp) ? rec.fisp : null;
  const lat = num(raw.lat), lon = num(raw.lon);
  return {
    bin,
    inFisp: raw.in_fisp_universe === true,
    address: str(raw.address),
    borough: str(raw.borough),
    lonLat: lat !== null && lon !== null ? [lon, lat] : null,
    prediction: mlRecordToPrediction(rec),
    fisp: fisp
      ? {
          statusOnRecord: str(fisp.status_on_record),
          currentCycle: num(fisp.current_cycle),
          currentCycleFiled: typeof fisp.current_cycle_filed === 'boolean' ? fisp.current_cycle_filed : null,
          filingWindowCloses: str(fisp.filing_window_closes),
        }
      : null,
    records: parseHistoryRecords(raw.records),
    movement: parseMovementBlock(raw.movement),
    sources: parseSources(raw.sources),
  };
}

export async function fetchHistory(bin: string, signal?: AbortSignal): Promise<BuildingHistory> {
  if (!API_BASE) throw new HistoryUnavailableError();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/buildings/${encodeURIComponent(bin)}/history`, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error(`Couldn't reach the ML API at ${API_BASE}; building history needs it (frontend/README.md).`);
  }
  if (res.status === 404) throw new Error('No history available: this API does not serve building history yet.');
  if (!res.ok) throw new Error(`History request failed (HTTP ${res.status}).`);
  return parseHistory(await res.json());
}

const FT_TO_M = 0.3048;

/** Footprint for one BIN from NYC Open Data, for buildings outside the prepared demo area. */
export function parseFootprint(raw: unknown, bin: string): BuildingFeature | null {
  if (!isObj(raw) || !Array.isArray(raw.features)) return null;
  // Several records can share a BIN (building parts): keep the largest ring, as prepare-buildings.mjs does.
  let best: BuildingFeature | null = null;
  let bestSize = -1;
  for (const f of raw.features) {
    if (!isObj(f) || !isObj(f.geometry) || !isObj(f.properties)) continue;
    const type = f.geometry.type;
    if (type !== 'Polygon' && type !== 'MultiPolygon') continue;
    const coords = f.geometry.coordinates as unknown[];
    const size = JSON.stringify(coords).length;
    if (size <= bestSize) continue;
    const h = Number(f.properties.height_roof ?? f.properties.heightroof);
    best = {
      type: 'Feature',
      geometry: f.geometry as unknown as BuildingFeature['geometry'],
      properties: { bin, address: null, height_m: Number.isFinite(h) && h > 0 ? h * FT_TO_M : null },
    };
    bestSize = size;
  }
  return best;
}

export async function fetchFootprint(bin: string, signal?: AbortSignal): Promise<BuildingFeature | null> {
  const res = await fetch(`${FOOTPRINTS_URL}?bin=${encodeURIComponent(bin)}`, { signal });
  if (!res.ok) return null;
  return parseFootprint(await res.json(), bin);
}
