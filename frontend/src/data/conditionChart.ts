import { FACADE_RATINGS, recordDate, type FacadeObservation, type FacadeRating } from './historyReplay';

export const CONDITION_DOT_MS = 380;
export const CONDITION_LINE_MS = 650;
export const CONDITION_FORECAST_DELAY_MS = 120;
export const CONDITION_FORECAST_MS = 420;
export const conditionY = (rating: FacadeRating) => 100 - FACADE_RATINGS.indexOf(rating) * 38;
export const conditionColor = (rating: FacadeRating) => rating === 'UNSAFE' ? '#a34438' : rating === 'SWARMP' ? '#916717' : '#247377';

/** Fixed calendar domain keeps existing points still as more observations are revealed. */
export function conditionChartData(observations: FacadeObservation[], domain: [string, string], range: [number, number] = [88, 306]) {
  const start = Date.parse(domain[0]), span = Date.parse(domain[1]) - start;
  const x = (date: string) => span > 0 ? range[0] + (Date.parse(date) - start) / span * (range[1] - range[0]) : (range[0] + range[1]) / 2;
  let ratedIndex = 0;
  let previousRated: { x: number; y: number; index: number } | null = null;
  return observations.flatMap((p, i) => {
    if (!p.rating) return []; // Gaps get a dashed bridge, never an invented observation.
    const node = {
      ...p, rating: p.rating, x: x(p.date), y: conditionY(p.rating),
      delay: Math.min(ratedIndex++ * 600, 1200),
      from: previousRated ? { x: previousRated.x, y: previousRated.y } : null,
      bridgesGap: previousRated !== null && previousRated.index < i - 1,
    };
    previousRated = { x: node.x, y: node.y, index: i };
    return [node];
  });
}

/** Fallback for browsers without the Web Animations API. */
export function conditionRevealDuration(nodes: ReturnType<typeof conditionChartData>): number {
  return Math.max(0, ...nodes.map((p) => p.delay + CONDITION_DOT_MS + (p.from ? CONDITION_LINE_MS : 0)));
}

export interface ConditionPrediction {
  probability: number | null;
  generatedAt?: string | null;
  isMock?: boolean;
  color?: string;
}

/** Never substitute a ranking score, an invented date or the latest live request for the loaded prediction. */
export function chartPrediction(prediction?: ConditionPrediction | null) {
  const probability = prediction?.probability;
  if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) return null;
  return {
    probability, percent: Math.round(probability * 100),
    generatedAt: recordDate(prediction?.generatedAt ?? null),
    isMock: prediction?.isMock ?? false,
    color: prediction?.color ?? 'var(--tint)',
  };
}
