import { useCallback, useEffect, useRef, useState } from 'react';
import { PUBLIC_DEMO } from '../config';
import { livePlatform, rescore, type LiveResult } from '../data/liveInference';
import { waitForResultReveal } from '../data/resultReveal';
import { scheduleTourInference, tourInferenceKey } from '../data/tourInference';

const ENGINE_LABEL: Record<string, string> = {
  'snapml-nnpa': 'IBM Z AI accelerator (NNPA) · Snap ML',
  xgboost: 'CPU · XGBoost',
};

/** Recompute this building's features and prediction on the live LinuxONE service and show what ran where. */
export function LiveRescore({ bin, storedProbability, demoRunId = 0, demoActive = false, demoWaiting = false, onDemoStart, onDemoComplete }: {
  bin: string; storedProbability: number | null; demoRunId?: number; demoActive?: boolean;
  demoWaiting?: boolean; onDemoStart?: () => void; onDemoComplete?: () => void;
}) {
  const [busy, setBusy] = useState<null | 'auto' | 'xgboost'>(null);
  const [live, setLive] = useState<LiveResult | null>(null);
  const [cpu, setCpu] = useState<LiveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const requestIsDemo = useRef(false);
  const lastTourAttempt = useRef<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const run = useCallback(async (engine: 'auto' | 'xgboost', demo = false) => {
    if (demo) lastTourAttempt.current = tourInferenceKey(demoRunId, bin);
    if (PUBLIC_DEMO) { // No service to call: the tour moves on, and nothing pretends to be live.
      if (demo) { onDemoStart?.(); onDemoComplete?.(); }
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    requestIsDemo.current = demo;
    const startedAt = performance.now();
    // A short presentation never waits indefinitely for a tunnel or remote feature build.
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, demo ? 6500 : 15000);
    setBusy(engine);
    if (demo) onDemoStart?.();
    setPreparing(false);
    setError(null);
    if (engine === 'auto') { setLive(null); setCpu(null); }
    try {
      const r = await rescore(bin, engine, controller.signal);
      if (controller.signal.aborted) return;
      window.clearTimeout(timer); // The real response is here; presentation pacing is not API time.
      setPreparing(true);
      await waitForResultReveal(startedAt, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      if (engine === 'auto') {
        setLive(r);
        setCpu(null);
      } else setCpu(r);
      if (demo) onDemoComplete?.();
    } catch (err) {
      if (controller.signal.aborted && !timedOut) return;
      setError(
        `${timedOut ? 'Live inference timed out' : `Live inference unavailable (${err instanceof Error ? err.message : String(err)})`}. ` +
          'No live result was produced. Check VITE_API_URL, the LinuxONE service and SSH tunnel, then retry.',
      );
      if (demo) onDemoComplete?.(); // Continue with the explicit failure, never a saved/fake result.
    } finally {
      window.clearTimeout(timer);
      if (request.current === controller) { request.current = null; setBusy(null); setPreparing(false); }
    }
  }, [bin, demoRunId, onDemoStart, onDemoComplete]);

  useEffect(() => {
    setLive(null); setCpu(null); setError(null);
    return () => { request.current?.abort(); };
  }, [bin, demoRunId]);
  useEffect(() => {
    if ((!demoActive || !demoWaiting) && requestIsDemo.current) request.current?.abort();
  }, [demoActive, demoWaiting]);
  useEffect(() => scheduleTourInference(
    { active: demoActive, waiting: demoWaiting, runId: demoRunId, bin },
    lastTourAttempt, () => { void run('auto', true); },
  ), [bin, demoActive, demoWaiting, demoRunId, run]);

  return (
    <section className="live-rescore" aria-live="polite" aria-busy={busy !== null} data-demo="inference">
      <div className="live-rescore__head">
        <h3 className="section-title">Live inference</h3>
        <button type="button" className="btn btn--primary btn--small" data-demo-action="run-inference" disabled={busy !== null || PUBLIC_DEMO} onClick={() => run('auto', demoWaiting)}>
          {PUBLIC_DEMO ? 'LinuxONE only' : busy === 'auto' ? preparing ? 'Revealing result…' : 'Requesting inference…' : 'Run on LinuxONE'}
        </button>
      </div>
      {!PUBLIC_DEMO && <p className="muted small">{live ? 'Recomputed now from cached records—not a fresh data download or retraining.' : 'Recompute this building’s saved prediction using cached records, without downloading new data or retraining.'}</p>}
      {PUBLIC_DEMO && <p className="notice small">Live recalculation runs on the team’s private IBM LinuxONE server, so it is not available in this public demo. The score shown was computed on LinuxONE and saved.</p>}
      {!PUBLIC_DEMO && !live && !busy && !error && <p className="muted small">Actual hardware and timing appear after the service responds.</p>}
      {demoWaiting && !busy && !live && !error && <p className="live-rescore__prompt">Starting automatically for the tour…</p>}
      {busy && <div className="live-rescore__loading" role="status">
        <p className="live-rescore__progress"><span className="spinner" aria-hidden />
          {preparing ? 'Response received · preparing result…' : 'Requesting fresh inference from the configured service…'}</p>
        <div className="live-rescore__loading-track" aria-hidden><span /></div>
        <p className="muted small">Brief presentation transition; actual server timing is shown with the result.</p>
      </div>}
      {error && <p className="error-text small">{error}</p>}
      {live && (
        <>
        <div className="live-rescore__result">
          <span>{livePlatform(live)}</span>
          <strong>{(live.probability * 100).toFixed(2)}%</strong>
          <span>Computed live · {ENGINE_LABEL[live.engine] ?? live.engine}</span>
          <span>{live.model_inference_ms.toFixed(3)} ms model · {live.total_ms_incl_features.toFixed(0)} ms incl. feature preparation</span>
        </div>
        <details className="detail-fold"><summary>Execution details &amp; model ID</summary>
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
              {livePlatform(live)} ({live.byteorder}-endian)
            </dd>
          </div>
          <div className="kv__row"><dt>Model ID</dt><dd className="mono">{live.model}</dd></div>
          <div className="kv__row"><dt>Response received (local)</dt><dd className="mono">{live.at}</dd></div>
        </dl>
        </details>
        <p className="muted small">The map and explanation charts still describe the loaded export, not this new live prediction.</p>
        </>
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
