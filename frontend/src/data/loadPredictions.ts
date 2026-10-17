import type {
  BuildingPrediction,
  Contribution,
  DataMode,
  Factors,
  ModelCard,
  ModelInfo,
  MovementMeta,
  MovementPoint,
  PredictionSet,
  RecordEvent,
  SourceRef,
} from '../types/predictions';
import { normalisePriority, priorityFromScore } from './priority';
import { PREDICTION_SOURCES, type PredictionSource } from '../config';

export const PREDICTIONS_URL = `${import.meta.env.BASE_URL}data/mock-predictions.json`;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const unit = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n >= 0 && n <= 1 ? n : null;
};
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s) : []);
const display = (v: unknown): string | null =>
  v === null || v === undefined ? null : typeof v === 'number' ? String(v) : str(v);

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
    .map((p) => ({ date: str(p.date), displacement_mm: num(p.displacement_mm), baseline_mm: num(p.baseline_mm) }))
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

function parseContributions(raw: unknown): Contribution[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((c) => ({
      label: str(c.label) ?? str(c.feature) ?? '',
      value: display(c.value),
      contribution: num(c.contribution) ?? num(c.shap) ?? num(c.log_odds) ?? Number.NaN,
    }))
    .filter((c) => c.label && Number.isFinite(c.contribution))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

function parseRecords(raw: unknown): RecordEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((r) => ({ date: str(r.date), type: str(r.type) ?? 'Record', description: str(r.description) ?? '' }))
    .filter((r) => r.description || r.date)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

function parseSources(raw: unknown): SourceRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((s) => ({ name: str(s.name) ?? '', observed_at: str(s.observed_at) }))
    .filter((s) => s.name);
}

function parseInterval(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const lo = unit(raw[0]), hi = unit(raw[1]);
  return lo !== null && hi !== null && lo <= hi ? [lo, hi] : null;
}

interface Candidate extends Omit<BuildingPrediction, 'rank'> {
  rank: number | null;
}

/** Frontend contract record (schema_version 1.x). */
function parseContractRecord(r: Json): Candidate | string {
  const score = num(r.score);
  if (score === null) return 'missing or non-numeric score';
  if (score < 0 || score > 1) return `score ${score} outside [0, 1]`;
  const rank = num(r.rank);
  return {
    bin: '',
    score,
    rank: rank !== null && rank >= 1 ? Math.round(rank) : null,
    priority: normalisePriority(r.priority) ?? priorityFromScore(score),
    confidence: unit(r.confidence),
    address: str(r.address),
    explanations: strList(r.explanations),
    factors: parseFactors(r.factors),
    movement_history: parseMovement(r.movement_history),
    probability: unit(r.probability),
    score_interval: parseInterval(r.score_interval),
    contributions: parseContributions(r.contributions),
    angular_distortion: num(r.angular_distortion),
    record_history: parseRecords(r.record_history),
    consequence: parseFactors(r.consequence),
    completeness: unit(r.completeness),
    missing_inputs: strList(r.missing_inputs),
    sources: parseSources(r.sources),
  };
}

const ML_STATUS_TYPE = 'FISP filing';

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
  const fisp = isObj(r.fisp) ? r.fisp : {};
  const history = Array.isArray(fisp.history) ? fisp.history.filter(isObj) : [];
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
        const value = display(d.value);
        return label ? (value ? `${label}: ${value}` : label) : null;
      })
      .filter((s): s is string => !!s),
    factors,
    movement_history: parseMovement(r.movement_history),
    probability: score,
    score_interval: null,
    contributions: parseContributions(drivers),
    angular_distortion: null,
    record_history: history
      .map((h) => ({
        date: str(h.filed_on),
        type: ML_STATUS_TYPE,
        description: `Cycle ${num(h.cycle) ?? '?'}: ${str(h.status) ?? 'unknown'}`,
      }))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
    consequence: {},
    completeness: null,
    missing_inputs: strList(r.missing),
    sources: [],
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
  const trainCycles = Array.isArray(model.train_cycles) ? model.train_cycles.map(num).filter((n) => n !== null) : [];
  return {
    name: str(model.name) ?? 'facade-inspection-priority',
    version: str(model.version) ?? str(model.model_sha256) ?? 'unknown',
    execution_platform: platform,
    trained_through:
      str(model.trained_through) ?? (trainCycles.length ? `FISP cycle ${Math.max(...(trainCycles as number[]))}` : null),
  };
}

function parseModelCard(raw: Json): ModelCard {
  const card = isObj(raw.model_card) ? raw.model_card : {};
  const metrics = Array.isArray(card.metrics)
    ? card.metrics
        .filter(isObj)
        .map((m) => ({ label: str(m.label) ?? '', value: display(m.value) }))
        .filter((m) => m.label)
    : [];
  const meta = isObj(raw.meta) ? raw.meta : {};
  return {
    target: str(card.target) ?? str(meta.label),
    score_definition: str(card.score_definition),
    confidence_definition: str(card.confidence_definition),
    metrics,
    limitations: strList(card.limitations).length ? strList(card.limitations) : strList(meta.caveats),
  };
}

function parseMovementMeta(raw: Json): MovementMeta {
  const m = isObj(raw.movement) ? raw.movement : {};
  return {
    measurement: str(m.measurement) ?? 'Line-of-sight (LOS) velocity',
    units: str(m.units) ?? 'mm/yr',
    source: str(m.source),
    posting_m: num(m.posting_m),
    aggregation_m: num(m.aggregation_m) ?? 60,
    period_start: str(m.period_start),
    period_end: str(m.period_end),
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
  const meta = isObj(raw.meta) ? raw.meta : {};

  return {
    schema_version: str(raw.schema_version) ?? 'ml-service',
    generated_at: str(raw.generated_at) ?? str(meta.generated_at),
    data_as_of: str(raw.data_as_of) ?? str(meta.as_of),
    data_mode,
    model: parseModel(raw),
    model_card: parseModelCard(raw),
    movement: parseMovementMeta(raw),
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

/** Try each configured source in order (live API → LinuxONE snapshot → mock); report which one was used. */
export async function loadPredictionsWithFallback(
  signal?: AbortSignal,
  sources: PredictionSource[] = PREDICTION_SOURCES,
): Promise<{ set: PredictionSet; source: PredictionSource; failures: string[] }> {
  const failures: string[] = [];
  for (const source of sources) {
    try {
      const set = await loadPredictions(source.url, AbortSignal.any ? AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(8000)]) : signal);
      if (set.buildings.length === 0) throw new Error('no scored buildings');
      return { set, source, failures };
    } catch (err) {
      if (signal?.aborted) throw err;
      failures.push(`${source.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`No prediction source could be loaded. ${failures.join(' · ')}`);
}
