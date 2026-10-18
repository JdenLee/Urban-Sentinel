import { useState } from 'react';
import { API_BASE } from '../config';

interface LiveResult {
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

const ENGINE_LABEL: Record<string, string> = {
  'snapml-nnpa': 'IBM Z AI accelerator (NNPA) · Snap ML',
  xgboost: 'CPU · XGBoost',
};

async function rescore(bin: string, engine: 'auto' | 'xgboost'): Promise<LiveResult> {
  const res = await fetch(`${API_BASE}/score/${bin}?engine=${engine}`, { method: 'POST', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return { ...d, at: new Date().toLocaleTimeString() };
}

/** Recompute this building's features and prediction on the live LinuxONE service and show what ran where. */
export function LiveRescore({ bin, storedProbability }: { bin: string; storedProbability: number | null }) {
  const [busy, setBusy] = useState<null | 'auto' | 'xgboost'>(null);
  const [live, setLive] = useState<LiveResult | null>(null);
  const [cpu, setCpu] = useState<LiveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (engine: 'auto' | 'xgboost') => {
    setBusy(engine);
    setError(null);
    try {
      const r = await rescore(bin, engine);
      if (engine === 'auto') {
        setLive(r);
        setCpu(null);
      } else setCpu(r);
    } catch (err) {
      setError(
        `Live service unreachable at ${API_BASE} (${err instanceof Error ? err.message : String(err)}). ` +
          'Open the SSH tunnel to the LinuxONE VM and try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="live-rescore" aria-live="polite">
      <div className="live-rescore__head">
        <h3 className="section-title">Live inference</h3>
        <button type="button" className="btn btn--primary btn--small" disabled={busy !== null} onClick={() => run('auto')}>
          {busy === 'auto' ? 'Running on IBM Z…' : 'Recalculate on IBM Z'}
        </button>
      </div>
      {error && <p className="error-text small">{error}</p>}
      {live && (
        <dl className="kv kv--tight">
          <div className="kv__row">
            <dt>Probability (live)</dt>
            <dd className="mono">
              {(live.probability * 100).toFixed(1)}%
              {storedProbability !== null && Math.abs(storedProbability - live.probability) >= 0.0005 && (
                <span className="muted"> (map: {(storedProbability * 100).toFixed(1)}%)</span>
              )}
            </dd>
          </div>
          <div className="kv__row">
            <dt>Engine</dt>
            <dd>{ENGINE_LABEL[live.engine] ?? live.engine}</dd>
          </div>
          <div className="kv__row">
            <dt>Model inference</dt>
            <dd className="mono">{live.model_inference_ms.toFixed(3)} ms</dd>
          </div>
          <div className="kv__row">
            <dt>End-to-end (incl. feature build)</dt>
            <dd className="mono">{live.total_ms_incl_features.toFixed(0)} ms</dd>
          </div>
          <div className="kv__row">
            <dt>Ran on</dt>
            <dd className="mono">
              {live.machine === 's390x' ? 'IBM LinuxONE · s390x' : live.machine} ({live.byteorder}-endian) · {live.at}
            </dd>
          </div>
        </dl>
      )}
      {live?.engine === 'snapml-nnpa' && (
        <div className="live-rescore__compare">
          <button type="button" className="btn btn--small" disabled={busy !== null} onClick={() => run('xgboost')}>
            {busy === 'xgboost' ? 'Running on CPU…' : 'Compare with CPU (XGBoost)'}
          </button>
          {cpu && (
            <p className="small mono">
              CPU: {(cpu.probability * 100).toFixed(1)}% in {cpu.model_inference_ms.toFixed(3)} ms · difference{' '}
              {Math.abs(cpu.probability - live.probability).toFixed(4)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
