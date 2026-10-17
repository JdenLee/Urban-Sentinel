/**
 * Where real data comes from. The live ML API runs on IBM LinuxONE and is reached through an SSH tunnel
 * (ml/deploy/linuxone/RUNBOOK.md); the committed snapshot keeps the demo working without it.
 */
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8000';

export interface PredictionSource {
  id: 'live-api' | 'linuxone-snapshot' | 'mock';
  label: string;
  url: string;
}

const base = import.meta.env.BASE_URL;

/** Tried in order; the first that loads and validates wins. Mock data is the last resort and is badged. */
export const PREDICTION_SOURCES: PredictionSource[] = [
  ...((import.meta.env.VITE_PREDICTIONS_URL as string | undefined)
    ? [{ id: 'live-api' as const, label: 'Custom source', url: import.meta.env.VITE_PREDICTIONS_URL as string }]
    : [{ id: 'live-api' as const, label: 'Live ML API', url: `${API_BASE}/predictions` }]),
  { id: 'linuxone-snapshot', label: 'Exported snapshot', url: `${base}data/linuxone-predictions.json` },
  { id: 'mock', label: 'Mock data', url: `${base}data/mock-predictions.json` },
];

export const GROUND_MOTION_SOURCES = [`${API_BASE}/layers/ground-motion.geojson`, `${base}data/insar-ground-motion.geojson`];
