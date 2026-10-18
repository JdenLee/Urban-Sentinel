import { API_BASE } from '../config';

export interface LiveResult {
  probability: number;
  engine: string;
  tree_format: string | null;
  model_inference_ms: number;
  total_ms_incl_features: number;
  machine: string;
  byteorder: string;
  model: string;
  at: string;
}

export function parseLiveResult(raw: unknown): LiveResult {
  if (!raw || typeof raw !== 'object') throw new Error('The service returned no inference result.');
  const d = raw as Record<string, unknown>;
  for (const key of ['probability', 'model_inference_ms', 'total_ms_incl_features']) {
    if (typeof d[key] !== 'number' || !Number.isFinite(d[key]) || d[key] < 0) throw new Error(`Invalid live ${key}.`);
  }
  if ((d.probability as number) > 1) throw new Error('Invalid live probability.');
  for (const key of ['engine', 'machine', 'byteorder', 'model']) {
    if (typeof d[key] !== 'string' || !d[key]) throw new Error(`Missing live ${key}.`);
  }
  return { ...d, tree_format: typeof d.tree_format === 'string' ? d.tree_format : null,
    at: new Date().toLocaleTimeString() } as LiveResult;
}

/** Only an actual s390x response is described as IBM Z; the saved snapshot is never a live result. */
export function livePlatform(result: Pick<LiveResult, 'machine'>): string {
  return result.machine === 's390x' ? 'IBM Z · s390x (service reported)' : `${result.machine} · not IBM Z`;
}

export async function rescore(bin: string, engine: 'auto' | 'xgboost', signal: AbortSignal): Promise<LiveResult> {
  if (!/^[1-5]\d{6}$/.test(bin)) throw new Error('A valid NYC BIN is required.');
  if (!API_BASE) throw new Error('Set VITE_API_URL to the LinuxONE service or SSH tunnel.');
  const res = await fetch(`${API_BASE}/score/${bin}?engine=${engine}`, { method: 'POST', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseLiveResult(await res.json());
}
