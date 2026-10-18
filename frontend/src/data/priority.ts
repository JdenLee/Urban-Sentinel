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
  low: [113, 153, 168],
  medium: [211, 188, 129],
  high: [197, 133, 91],
  critical: [166, 77, 70],
};
export const UNSCORED_COLOR: RGB = [182, 179, 168];
/** Results already recorded this cycle: muted, so they read as "on file" rather than as predictions. */
export const RECORDED_COLOR: Record<string, RGB> = {
  UNSAFE: [150, 64, 72],
  SWARMP: [150, 128, 70],
  SAFE: [82, 112, 128],
};
export const RECORDED_ORDER = ['UNSAFE', 'SWARMP', 'SAFE'] as const;
/** Scored buildings hidden by a filter or capacity cutoff. */
export const FILTERED_COLOR: RGB = [172, 176, 171];
export const SELECTED_COLOR: RGB = [70, 119, 125];

/** Legend ranges with half-open bounds so no score falls in two categories. */
export const PRIORITY_RANGE: Record<Priority, string> = {
  critical: `≥ ${PRIORITY_THRESHOLDS.critical.toFixed(2)}`,
  high: `${PRIORITY_THRESHOLDS.high.toFixed(2)}–<${PRIORITY_THRESHOLDS.critical.toFixed(2)}`,
  medium: `${PRIORITY_THRESHOLDS.medium.toFixed(2)}–<${PRIORITY_THRESHOLDS.high.toFixed(2)}`,
  low: `< ${PRIORITY_THRESHOLDS.medium.toFixed(2)}`,
};

export function rgbCss([r, g, b]: RGB, alpha = 1): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
