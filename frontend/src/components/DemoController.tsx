import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { CameraStop } from '../camera';
import { prefersReducedMotion } from '../camera';
import { DEMO_DURATION_MS, DEMO_RECORDS_PAUSE_MS, DEMO_INFERENCE_PAUSE_MS, DEMO_EXPLANATIONS_AT_MS, DEMO_HISTORY_PAUSE_MS, DEMO_FOCUS_AT_MS, DEMO_FOCUS_DURATION_MS, DEMO_FINALE_AT_MS, PANEL_STOPS, type DemoCue, type DemoOpeningPhase } from '../data/demoScript';
import { CITY_RISE_MS, CITY_SWEEP_MS, CITY_COLOR_AT_MS, smoothstep } from '../motion/sceneMotion';
import { afterCameraArrival } from '../motion/cameraArrival';

export { DEMO_DURATION_MS } from '../data/demoScript';
const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * Headroom inside the map. The panels float over it, so the demo frames its subject into the strip
 * they leave clear: the record card on the right, the desk on the left while it is open, and below
 * 760px the record becomes a bottom sheet instead and the desk is already closed.
 */
export function demoPadding(width: number, height: number, deskOpen = false) {
  if (width <= 760) return { top: 72, bottom: Math.round(height * 0.68), left: 24, right: 24 };
  const rail = width <= 1100 ? 328 : 350;
  return { top: 86, bottom: 70, left: deskOpen ? rail : 28, right: width <= 1100 ? 380 : 412 };
}

const duration = (ms: number) => prefersReducedMotion() ? 0 : ms;

export interface DemoTarget {
  bin: string;
  center: [number, number];
  height_m: number;
}

export interface DemoActions {
  map: MapLibreMap;
  target: DemoTarget | null;
  /** Read at the moment of framing: the desk can be closed by hand while the demo runs. */
  deskOpen: () => boolean;
  setShowRisk: (v: boolean) => void;
  setShowMovement: (v: boolean) => void;
  setSelectedBin: (bin: string | null) => void;
  setPanelOpen: (v: boolean) => void;
  present: (cue: DemoCue | null) => void;
  setOpeningPhase: (phase: DemoOpeningPhase) => void;
  afterArrival: (fn: () => void) => void;
  /** Schedule a follow-up inside a step; cancelled if the demo stops. */
  later: (fn: () => void, ms: number) => void;
}

export interface DemoStep {
  at: number;
  stage: string;
  run: (a: DemoActions) => void;
}

const START: CameraStop = { center: [-74.006, 40.704], zoom: 13.0, pitch: 40, bearing: -18 };
const APPROACH: CameraStop = { center: [-74.004, 40.712], zoom: 14.45, pitch: 56, bearing: 8 };
const FINALE: CameraStop = { center: [-74.0005, 40.7165], zoom: 14.25, pitch: 56, bearing: 22 };

/** Gray rise → approach with colour fade → arrive at building → highlight and pin. */
export function demoTimeline(): DemoStep[] {
  return [
    {
      at: 0,
      stage: 'Lower Manhattan · buildings rising',
      run: ({ map, setShowRisk, setShowMovement, setSelectedBin, setPanelOpen, setOpeningPhase }) => {
        setOpeningPhase('rise');
        setShowRisk(false);
        setShowMovement(false);
        setSelectedBin(null);
        setPanelOpen(false);
        map.jumpTo({ ...START, padding: NO_PADDING });
      },
    },
    {
      at: CITY_RISE_MS,
      stage: 'Approaching the city',
      run: ({ map, setOpeningPhase }) => {
        setOpeningPhase('approach');
        map.flyTo({ ...APPROACH, duration: duration(CITY_SWEEP_MS), curve: 1.15, easing: smoothstep, essential: false });
      },
    },
    {
      at: CITY_COLOR_AT_MS,
      stage: 'Approaching · revealing inspection priorities',
      run: ({ setShowRisk, setOpeningPhase }) => {
        setOpeningPhase('reveal');
        setShowRisk(true);
      },
    },
    {
      at: DEMO_FOCUS_AT_MS,
      stage: 'Explore a priority building',
      run: ({ map, target, deskOpen, setSelectedBin, setOpeningPhase, afterArrival }) => {
        setOpeningPhase('complete');
        if (!target) return;
        const width = map.getContainer().clientWidth;
        const zoom = (target.height_m > 120 ? 15.8 : 16.25) - (width <= 760 ? 0.65 : 0);
        // Never flash the selection or drop its pin while the camera is still far away.
        // Stop first so a prior animation's moveend cannot satisfy this arrival listener.
        map.stop();
        afterArrival(() => setSelectedBin(target.bin));
        map.flyTo({ center: target.center, zoom, pitch: 58, bearing: 36,
          padding: demoPadding(map.getContainer().clientWidth, map.getContainer().clientHeight, deskOpen()),
          duration: duration(DEMO_FOCUS_DURATION_MS), curve: 1.15, easing: smoothstep, essential: false });
      },
    },
    ...PANEL_STOPS.map(({ at, stage, cue }): DemoStep => ({ at, stage, run: ({ setPanelOpen, present }) => {
      setPanelOpen(true);
      present(cue);
    } })),
    {
      at: DEMO_FINALE_AT_MS,
      stage: 'From evidence to inspection priorities',
      run: ({ map, setPanelOpen, present }) => {
        setPanelOpen(false);
        present(null);
        map.flyTo({ ...FINALE, padding: NO_PADDING, duration: duration(3000), curve: 1.15, easing: smoothstep, essential: false });
      },
    },
  ];
}

export function useDemoRunner(getActions: () => Omit<DemoActions, 'later' | 'present' | 'setOpeningPhase' | 'afterArrival'> | null) {
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [awaitingInference, setAwaitingInference] = useState(false);
  const [inferenceBusy, setInferenceBusy] = useState(false);
  const inferencePauseRef = useRef(false);
  const [awaitingHistory, setAwaitingHistory] = useState(false);
  const historyPauseRef = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [stage, setStage] = useState('');
  const [cue, setCue] = useState<DemoCue | null>(null);
  const [runId, setRunId] = useState(0);
  const [openingPhase, setOpeningPhase] = useState<DemoOpeningPhase>('complete');
  const timers = useRef<number[]>([]);
  const arrivals = useRef<Array<() => void>>([]);
  const clock = useRef<number | undefined>(undefined);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);

  const clear = () => {
    arrivals.current.forEach((cancel) => cancel());
    arrivals.current = [];
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    window.clearInterval(clock.current);
  };

  const stop = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    clear();
    getActions()?.map.stop();
    setRunning(false);
    pausedRef.current = false;
    setPaused(false);
    setAwaitingInference(false);
    setInferenceBusy(false);
    inferencePauseRef.current = false;
    setAwaitingHistory(false);
    historyPauseRef.current = false;
    setCue(null);
  }, [getActions]);

  const playFrom = useCallback((offset: number) => {
    const actions = getActions();
    if (!actions?.target) return;
    clear();
    runningRef.current = true;
    pausedRef.current = false;
    setRunning(true);
    setPaused(false);
    setAwaitingInference(false);
    setInferenceBusy(false);
    inferencePauseRef.current = false;
    setAwaitingHistory(false);
    historyPauseRef.current = false;
    setElapsed(offset);

    const schedule = (fn: () => void, ms: number) => {
      timers.current.push(window.setTimeout(() => runningRef.current && fn(), ms));
    };
    const ctx: DemoActions = { ...actions, later: schedule, present: setCue, setOpeningPhase,
      afterArrival: (fn) => {
        arrivals.current.push(afterCameraArrival(actions.map, () => {
          if (runningRef.current && !pausedRef.current) fn();
        }));
      },
    };
    for (const step of demoTimeline()) {
      if (step.at < offset) continue;
      const run = () => {
        setStage(step.stage);
        step.run(ctx);
      };
      // Reset selection and colours in the same render as the replay's height reset.
      if (step.at === offset) run(); else schedule(run, step.at - offset);
    }
    if (offset < DEMO_INFERENCE_PAUSE_MS) schedule(() => {
      clear();
      pausedRef.current = true;
      inferencePauseRef.current = true;
      setPaused(true);
      setAwaitingInference(true);
      setElapsed(DEMO_INFERENCE_PAUSE_MS);
      setStage('Starting live prediction automatically…');
      actions.map.stop();
    }, DEMO_INFERENCE_PAUSE_MS - offset);
    if (offset < DEMO_HISTORY_PAUSE_MS) schedule(() => {
      clear();
      pausedRef.current = true;
      historyPauseRef.current = true;
      setPaused(true);
      setAwaitingHistory(true);
      setElapsed(DEMO_HISTORY_PAUSE_MS);
      setStage('Connecting recorded history…');
      actions.map.stop();
    }, DEMO_HISTORY_PAUSE_MS - offset);
    if (offset < DEMO_RECORDS_PAUSE_MS) schedule(() => {
      clear();
      pausedRef.current = true;
      setPaused(true);
      setElapsed(DEMO_RECORDS_PAUSE_MS);
      setStage('Paused · explore official NYC records');
      actions.map.stop();
    }, DEMO_RECORDS_PAUSE_MS - offset);
    schedule(() => {
      runningRef.current = false;
      setRunning(false);
      window.clearInterval(clock.current);
      setElapsed(DEMO_DURATION_MS);
      setCue(null);
    }, DEMO_DURATION_MS - offset);

    const t0 = performance.now();
    // The small clock update also drives a progress line that freezes exactly at the records pause.
    clock.current = window.setInterval(() => {
      if (runningRef.current && !pausedRef.current) setElapsed(Math.min(DEMO_DURATION_MS, offset + performance.now() - t0));
    }, 250);
  }, [getActions]);

  const start = useCallback(() => {
    if (!getActions()?.target) return;
    setRunId((id) => id + 1);
    setCue(null);
    playFrom(0);
  }, [getActions, playFrom]);
  const resume = useCallback(() => {
    if (runningRef.current && pausedRef.current && !inferencePauseRef.current && !historyPauseRef.current) playFrom(DEMO_RECORDS_PAUSE_MS);
  }, [playFrom]);
  const completeInference = useCallback(() => {
    if (runningRef.current && inferencePauseRef.current) playFrom(DEMO_INFERENCE_PAUSE_MS);
  }, [playFrom]);
  const completeHistory = useCallback(() => {
    // The 2.5s reading beat starts after the dots, connectors and prediction reveal finish.
    if (runningRef.current && historyPauseRef.current) playFrom(DEMO_HISTORY_PAUSE_MS);
  }, [playFrom]);
  const beginInference = useCallback(() => {
    if (!runningRef.current || !inferencePauseRef.current) return;
    setInferenceBusy(true);
    setStage('Running live prediction…');
  }, []);
  const skipInference = useCallback(() => {
    // Resume at explanations, not the result hold: a skipped request has no live result.
    if (runningRef.current && inferencePauseRef.current) playFrom(DEMO_EXPLANATIONS_AT_MS);
  }, [playFrom]);
  const releaseCue = useCallback(() => setCue(null), []);

  useEffect(() => clear, []);
  useEffect(() => {
    // Opening official records in a new tab must not dismiss the paused presentation.
    const hide = () => { if (document.hidden && !pausedRef.current) stop(); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [stop]);

  return { running, paused, awaitingInference, awaitingHistory, completeHistory, inferenceBusy, beginInference, completeInference, skipInference, elapsed, stage, cue, runId, openingPhase, start, stop, resume, releaseCue };
}

export interface DemoControllerProps {
  running: boolean;
  paused: boolean;
  awaitingInference: boolean;
  awaitingHistory: boolean;
  inferenceBusy: boolean;
  elapsed: number;
  stage: string;
  onStop: () => void;
  onContinue: () => void;
  onSkipInference: () => void;
}

/** Progress strip shown along the bottom while Demo Mode runs. */
export function DemoController({ running, paused, awaitingInference, awaitingHistory, inferenceBusy, elapsed, stage, onStop, onContinue, onSkipInference }: DemoControllerProps) {
  if (!running) return null;
  return (
    <div className={`demo-strip${paused ? ' demo-strip--paused' : ''}`} role="status" aria-live="polite">
      <div className="demo-strip__row">
        <span className="demo-strip__dot" aria-hidden />
        <span className="demo-strip__label">{paused && !awaitingInference && !awaitingHistory ? 'Tour paused' : 'Tour'}</span>
        <span className="demo-strip__stage">{stage}</span>
        <span className="demo-strip__time">{(elapsed / 1000).toFixed(0).padStart(2, '0')}s / {DEMO_DURATION_MS / 1000}s</span>
        {paused && !awaitingInference && !awaitingHistory && <button type="button" className="demo-strip__stop demo-strip__continue" onClick={onContinue}>Finish tour →</button>}
        {paused && awaitingInference && <button type="button" className="demo-strip__stop demo-strip__continue" onClick={onSkipInference}>Skip live step →</button>}
        <button type="button" className="demo-strip__stop" onClick={onStop}>
          Stop <kbd>Esc</kbd>
        </button>
      </div>
      {paused && <p className="demo-strip__hint">{awaitingHistory
        ? 'The tour continues automatically once the dots and lines finish drawing and the prediction appears.'
        : awaitingInference
        ? inferenceBusy ? 'Running automatically. The tour continues after the result; you can also skip this step.'
          : 'Starting LinuxONE inference automatically. No click needed.'
        : 'Take your time with the records. Click Finish tour when you’re ready.'}</p>}
      <div className="demo-strip__track">
        <div className="demo-strip__fill" style={{ transform: `scaleX(${elapsed / DEMO_DURATION_MS})` }} />
      </div>
    </div>
  );
}
