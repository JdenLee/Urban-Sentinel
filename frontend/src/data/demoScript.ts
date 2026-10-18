import type { JoinedFeature } from '../types/predictions';

export const DEMO_DURATION_MS = 41_000;
export const DEMO_FOCUS_AT_MS = 6000;
export const DEMO_FOCUS_DURATION_MS = 4500;
export const DEMO_FINALE_AT_MS = 38_000;
export type DemoOpeningPhase = 'rise' | 'approach' | 'reveal' | 'complete';
/** Active time; paused reading time is intentionally unbounded. */
export const DEMO_RECORDS_PAUSE_MS = 37_000;
export const DEMO_INFERENCE_PAUSE_MS = 19_000;
export const DEMO_EXPLANATIONS_AT_MS = 26_000;
export const DEMO_HISTORY_PAUSE_MS = 33_000;
export type DemoSection = 'score' | 'photos' | 'facts' | 'inference' | 'contributions' | 'history' | 'history-charts' | 'official';
export interface DemoCue {
  tab: 'overview' | 'evidence' | 'history';
  section: DemoSection;
  awaitInference?: boolean;
  historyProgress?: number;
  image?: 'aerial' | 'street';
}

/** Prefer the requested address only when it is actually scored; never relabel a neighbour. */
export function chooseDemoBuilding(scored: JoinedFeature[]): JoinedFeature | null {
  const ranked = scored.filter((f) => f.properties.prediction).slice().sort((a, b) =>
    a.properties.prediction!.rank - b.properties.prediction!.rank);
  return ranked.find((f) => /^707FDR(?:DRIVE|DR)$/.test((f.properties.address ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''))) ?? ranked[0] ?? null;
}

export const PANEL_STOPS: ReadonlyArray<{ at: number; stage: string; cue: DemoCue }> = [
  { at: 11_000, stage: 'A probability, not a collapse forecast', cue: { tab: 'overview', section: 'score' } },
  { at: 13_000, stage: 'See the real building · aerial view', cue: { tab: 'overview', section: 'photos', image: 'aerial' } },
  { at: 15_000, stage: 'At street level · Google Street View', cue: { tab: 'overview', section: 'photos', image: 'street' } },
  { at: 17_500, stage: 'Floors, units and building use', cue: { tab: 'overview', section: 'facts' } },
  { at: DEMO_INFERENCE_PAUSE_MS, stage: 'Live inference · actual engine and timing', cue: { tab: 'overview', section: 'inference', awaitInference: true } },
  { at: DEMO_EXPLANATIONS_AT_MS, stage: 'What raised or lowered the score?', cue: { tab: 'evidence', section: 'contributions' } },
  { at: 30_000, stage: 'Recorded history · observed dates only', cue: { tab: 'history', section: 'history', historyProgress: 0 } },
  { at: 31_500, stage: 'How the record changed', cue: { tab: 'history', section: 'history', historyProgress: 0.5 } },
  { at: DEMO_HISTORY_PAUSE_MS, stage: 'Recorded history → model prediction', cue: { tab: 'history', section: 'history-charts', historyProgress: 1 } },
  { at: 35_500, stage: 'Trace the evidence to official NYC records', cue: { tab: 'history', section: 'official', historyProgress: 1 } },
];

export function historyIndex(progress: number, length: number): number {
  return Math.round(Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 1)) * Math.max(0, length - 1));
}
