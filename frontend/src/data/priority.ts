import type { Priority } from '../types/predictions';

/** Default thresholds from the data contract. */
export const PRIORITY_THRESHOLDS = { critical: 0.85, high: 0.7, medium: 0.45 } as const;

export function priorityFromScore(score: number): Priority {
  if (score >= PRIORITY_THRESHOLDS.critical) return 'critical';
  if (score >= PRIORITY_THRESHOLDS.high) return 'high';
  if (score >= PRIORITY_THRESHOLDS.medium) return 'medium';
  return 'low';
}

/**
 * Accepts the frontend contract's categories, plus the ML service's rank-percentile tiers
 * (ml/contract/building_score.schema.json: high / elevated / typical / low).
 */
const PRIORITY_ALIASES: Record<string, Priority> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};
const ML_TIER_ALIASES: Record<string, Priority> = {
  high: 'critical',
  elevated: 'high',
  typical: 'medium',
  low: 'low',
};

export function normalisePriority(value: unknown, mlTier = false): Priority | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  return (mlTier ? ML_TIER_ALIASES : PRIORITY_ALIASES)[key] ?? null;
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

type RGB = [number, number, number];
export const PRIORITY_COLOR: Record<Priority, RGB> = {
  low: [56, 140, 255],
  medium: [250, 214, 56],
  high: [255, 140, 26],
  critical: [255, 46, 64],
};
export const UNSCORED_COLOR: RGB = [52, 60, 78];
export const SELECTED_COLOR: RGB = [180, 255, 255];

export function rgbCss([r, g, b]: RGB, alpha = 1): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
