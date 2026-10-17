import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

export type Priority = 'low' | 'medium' | 'high' | 'critical';
export const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'critical'];

export type DataMode = 'mock' | 'real';

export interface MovementPoint {
  date: string;
  displacement_mm: number;
}

/** Numeric model factors; unknown keys from the ML export are kept and shown as-is. */
export type Factors = Record<string, number | string | null>;

/** One scored building after validation and normalisation. */
export interface BuildingPrediction {
  bin: string;
  score: number;
  rank: number;
  priority: Priority;
  confidence: number | null;
  address: string | null;
  explanations: string[];
  factors: Factors;
  movement_history: MovementPoint[];
}

export interface ModelInfo {
  name: string;
  version: string;
  execution_platform: string;
}

export interface PredictionSet {
  schema_version: string;
  generated_at: string | null;
  data_mode: DataMode;
  model: ModelInfo;
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

export interface JoinResult {
  features: JoinedFeature[];
  scored: JoinedFeature[];
  /** Predictions whose BIN has no footprint in the demo area. */
  unmatchedPredictions: BuildingPrediction[];
}
