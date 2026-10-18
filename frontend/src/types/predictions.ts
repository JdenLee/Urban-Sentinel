import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

export type Priority = 'low' | 'medium' | 'high' | 'critical';
export const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'critical'];

export type DataMode = 'mock' | 'real';

export interface MovementPoint {
  date: string;
  displacement_mm: number;
  /** Expected seasonal/thermal displacement for the same date, if supplied. */
  baseline_mm: number | null;
}

/** Signed per-feature contribution to the score (e.g. TreeSHAP log-odds). */
export interface Contribution {
  label: string;
  value: string | null;
  contribution: number;
}

export interface RecordEvent {
  date: string | null;
  type: string;
  description: string;
  /** FISP cycle of a façade filing, when known (used to link to the official record). */
  cycle?: number | null;
  /** Official identifier of the record, e.g. the FISP TR6 report number. */
  reference?: string | null;
}

export interface SourceRef {
  name: string;
  observed_at: string | null;
}

/** Numeric model factors; unknown keys from the ML export are kept and shown as-is. */
export type Factors = Record<string, number | string | null>;

/** One scored building after validation and normalisation. */
export interface BuildingPrediction {
  bin: string;
  score: number;
  rank: number;
  /** Size of the ranked set `rank` is out of (ML export's `prediction.of`); null = the whole prediction file. */
  rank_total: number | null;
  priority: Priority;
  confidence: number | null;
  address: string | null;
  explanations: string[];
  factors: Factors;
  movement_history: MovementPoint[];
  /** Optional decision-support fields; the UI hides any section whose data is absent. */
  probability: number | null;
  score_interval: [number, number] | null;
  contributions: Contribution[];
  angular_distortion: number | null;
  record_history: RecordEvent[];
  consequence: Factors;
  completeness: number | null;
  missing_inputs: string[];
  sources: SourceRef[];
}

export interface ModelInfo {
  name: string;
  version: string;
  execution_platform: string;
  trained_through: string | null;
}

export interface ModelCard {
  target: string | null;
  score_definition: string | null;
  confidence_definition: string | null;
  /** Backtest metrics as label/value pairs, rendered in order. */
  metrics: { label: string; value: string | null }[];
  limitations: string[];
}

export interface MovementMeta {
  measurement: string;
  units: string;
  source: string | null;
  posting_m: number | null;
  aggregation_m: number;
  period_start: string | null;
  period_end: string | null;
}

export interface PredictionSet {
  schema_version: string;
  generated_at: string | null;
  data_as_of: string | null;
  data_mode: DataMode;
  model: ModelInfo;
  model_card: ModelCard;
  movement: MovementMeta;
  buildings: BuildingPrediction[];
  /** Records dropped during validation, with the reason, for the console and tests. */
  rejected: { bin: string | null; reason: string }[];
}

export interface BuildingProperties {
  bin: string;
  address: string | null;
  height_m: number | null;
  year_built?: number | null;
}

export type BuildingGeometry = Polygon | MultiPolygon;
export type BuildingFeature = Feature<BuildingGeometry, BuildingProperties>;
export type BuildingCollection = FeatureCollection<BuildingGeometry, BuildingProperties>;

/** Footprint joined with its prediction (null when unscored). */
export interface JoinedProperties extends BuildingProperties {
  height_m: number;
  height_estimated: boolean;
  prediction: BuildingPrediction | null;
}
export type JoinedFeature = Feature<BuildingGeometry, JoinedProperties>;

/** A building chosen from search: BIN plus where to fly when it has no footprint in the scene. */
export interface LookupTarget {
  bin: string;
  label: string | null;
  lonLat: [number, number] | null;
}

/** InSAR series metadata from GET /buildings/{bin}/history (ml/insar/export_series.py). */
export interface MovementSeriesMeta {
  measurement: string;
  units: string;
  source: string | null;
  period_start: string | null;
  period_end: string | null;
  baseline_label: string | null;
  sign: string | null;
  note: string | null;
}

export interface HistoryRecord extends RecordEvent {
  /** FISP filing status (SAFE / SWARMP / UNSAFE / No Report Filed), when the record is a filing. */
  status: string | null;
}

/** Everything on record for one building, from the ML API's history endpoint. */
export interface BuildingHistory {
  bin: string;
  inFisp: boolean;
  address: string | null;
  borough: string | null;
  lonLat: [number, number] | null;
  /** Present when the building has a current-cycle prediction; null if already filed or not in FISP. */
  prediction: BuildingPrediction | null;
  fisp: {
    statusOnRecord: string | null;
    currentCycle: number | null;
    currentCycleFiled: boolean | null;
    filingWindowCloses: string | null;
  } | null;
  records: HistoryRecord[];
  movement: { meta: MovementSeriesMeta; points: MovementPoint[]; velocityHp: number | null } | null;
  sources: SourceRef[];
}

export type HistoryState =
  | { status: 'idle' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: BuildingHistory };

export interface JoinResult {
  features: JoinedFeature[];
  scored: JoinedFeature[];
  /** Predictions whose BIN has no footprint in the demo area. */
  unmatchedPredictions: BuildingPrediction[];
}
