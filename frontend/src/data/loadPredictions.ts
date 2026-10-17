import type {
  BuildingPrediction,
  DataMode,
  Factors,
  ModelInfo,
  MovementPoint,
  PredictionSet,
} from '../types/predictions';
import { normalisePriority, priorityFromScore } from './priority';

export const PREDICTIONS_URL = `${import.meta.env.BASE_URL}data/mock-predictions.json`;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** BINs may arrive as numbers or "1000010.0"; the join key is always the integer string. */
export function binString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/\.0+$/, '');
  return /^\d{7}$/.test(s) ? s : null;
}

function parseMovement(raw: unknown): MovementPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((p) => ({ date: str(p.date), displacement_mm: num(p.displacement_mm) }))
    .filter((p): p is MovementPoint => p.date !== null && p.displacement_mm !== null && !Number.isNaN(Date.parse(p.date)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parseFactors(raw: unknown): Factors {
  if (!isObj(raw)) return {};
  const out: Factors = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' || typeof v === 'string' || v === null) out[k] = v;
  }
  return out;
}

interface Candidate extends Omit<BuildingPrediction, 'rank'> {
  rank: number | null;
}

/** Frontend contract record (schema_version 1.0). */
function parseContractRecord(r: Json): Candidate | string {
  const score = num(r.score);
  if (score === null) return 'missing or non-numeric score';
  if (score < 0 || score > 1) return `score ${score} outside [0, 1]`;
  const rank = num(r.rank);
  const confidence = num(r.confidence);
  return {
    bin: '',
    score,
    rank: rank !== null && rank >= 1 ? Math.round(rank) : null,
    priority: normalisePriority(r.priority) ?? priorityFromScore(score),
    confidence: confidence !== null && confidence >= 0 && confidence <= 1 ? confidence : null,
    address: str(r.address),
    explanations: Array.isArray(r.explanations) ? r.explanations.map(str).filter((s): s is string => !!s) : [],
    factors: parseFactors(r.factors),
    movement_history: parseMovement(r.movement_history),
  };
}

/** ML service record (ml/contract/building_score.schema.json): score lives in `prediction`. */
function parseMlServiceRecord(r: Json): Candidate | string {
  if (r.prediction === null) return 'no prediction (already filed this cycle)';
  const p = r.prediction as Json;
  const score = num(p.probability);
  if (score === null) return 'missing or non-numeric probability';
  if (score < 0 || score > 1) return `probability ${score} outside [0, 1]`;
  const drivers = Array.isArray(r.drivers) ? r.drivers.filter(isObj) : [];
  const factors: Factors = {};
  for (const d of drivers) {
    const label = str(d.label) ?? str(d.feature);
    if (label) factors[label] = (d.value as string | number | null) ?? null;
  }
  const rank = num(p.rank);
  return {
    bin: '',
    score,
    rank: rank !== null && rank >= 1 ? Math.round(rank) : null,
    priority: normalisePriority(p.tier, true) ?? priorityFromScore(score),
    confidence: null,
    address: str(r.address),
    explanations: drivers
      .filter((d) => d.effect !== 'lowers')
      .map((d) => {
        const label = str(d.label) ?? str(d.feature);
        const value = str(String(d.value ?? ''));
        return label ? (value ? `${label}: ${value}` : label) : null;
      })
      .filter((s): s is string => !!s),
    factors,
    movement_history: parseMovement(r.movement_history),
  };
}

function parseModel(raw: Json): ModelInfo {
  const model = isObj(raw.model) ? raw.model : isObj(raw.meta) && isObj(raw.meta.model) ? raw.meta.model : {};
  const firstPrediction = Array.isArray(raw.buildings)
    ? (raw.buildings.find((b) => isObj(b) && isObj(b.prediction)) as Json | undefined)
    : undefined;
  const machine = firstPrediction && isObj(firstPrediction.prediction) && isObj(firstPrediction.prediction.scored_on)
    ? str(firstPrediction.prediction.scored_on.machine)
    : null;
  const platform = str(model.execution_platform) ?? (machine === 's390x' ? 'IBM LinuxONE' : machine) ?? 'unknown';
  return {
    name: str(model.name) ?? 'facade-inspection-priority',
    version: str(model.version) ?? str(model.model_sha256) ?? 'unknown',
    execution_platform: platform,
  };
}

/**
 * Validate and normalise a prediction export. Accepts the frontend contract
 * (`{schema_version, data_mode, model, buildings: [{bin, score, …}]}`) or the ML service's
 * `{meta, buildings: [{bin, prediction: {probability, rank, tier}, drivers}]}` output, so a real
 * export can replace mock-predictions.json without code changes.
 */
export function parsePredictions(raw: unknown): PredictionSet {
  if (!isObj(raw) || !Array.isArray(raw.buildings)) {
    throw new Error('Prediction file must be an object with a "buildings" array.');
  }
  const mode = str(raw.data_mode);
  const data_mode: DataMode = mode === 'mock' ? 'mock' : 'real';
  const rejected: PredictionSet['rejected'] = [];
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (const item of raw.buildings) {
    if (!isObj(item)) {
      rejected.push({ bin: null, reason: 'record is not an object' });
      continue;
    }
    const bin = binString(item.bin);
    if (!bin) {
      rejected.push({ bin: item.bin == null ? null : String(item.bin), reason: 'invalid BIN' });
      continue;
    }
    if (seen.has(bin)) {
      rejected.push({ bin, reason: 'duplicate BIN' });
      continue;
    }
    const parsed = 'prediction' in item && !('score' in item) ? parseMlServiceRecord(item) : parseContractRecord(item);
    if (typeof parsed === 'string') {
      rejected.push({ bin, reason: parsed });
      continue;
    }
    seen.add(bin);
    candidates.push({ ...parsed, bin });
  }

  // Use supplied ranks when every record has one; otherwise rank by score.
  const allRanked = candidates.every((c) => c.rank !== null);
  const ordered = [...candidates].sort((a, b) =>
    allRanked ? (a.rank as number) - (b.rank as number) : b.score - a.score || a.bin.localeCompare(b.bin),
  );
  const buildings: BuildingPrediction[] = ordered.map((c, i) => ({ ...c, rank: allRanked ? (c.rank as number) : i + 1 }));

  return {
    schema_version: str(raw.schema_version) ?? 'ml-service',
    generated_at: str(raw.generated_at) ?? (isObj(raw.meta) ? str(raw.meta.generated_at) : null),
    data_mode,
    model: parseModel(raw),
    buildings,
    rejected,
  };
}

export async function loadPredictions(url = PREDICTIONS_URL, signal?: AbortSignal): Promise<PredictionSet> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Could not load predictions (${url}): HTTP ${res.status}`);
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new Error(`Predictions file is not valid JSON (${url}).`);
  }
  const set = parsePredictions(raw);
  if (set.rejected.length) {
    console.warn(`[predictions] ${set.rejected.length} record(s) skipped`, set.rejected.slice(0, 20));
  }
  return set;
}
