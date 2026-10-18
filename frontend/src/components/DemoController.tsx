import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { CameraStop } from '../camera';
import { prefersReducedMotion } from '../camera';

export const DEMO_DURATION_MS = 30_000;
const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * Headroom inside the map viewport. Above 760px the chassis docks, so the viewport already excludes
 * the rail and the building record and only the building itself needs framing; below that they
 * overlay the map and the record covers the lower part of it.
 */
export function demoPadding(width: number, height: number) {
  if (width <= 760) return { top: 56, bottom: Math.round(height * 0.62), left: 20, right: 20 };
  return { top: 72, bottom: 48, left: 28, right: 28 };
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
  setShowRisk: (v: boolean) => void;
  setShowMovement: (v: boolean) => void;
  setSelectedBin: (bin: string | null) => void;
  setPanelOpen: (v: boolean) => void;
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

const smooth = (t: number) => t * t * (3 - 2 * t);

/** The fixed 30-second script. Every call returns the same steps with the same timings. */
export function demoTimeline(): DemoStep[] {
  return [
    {
      at: 0,
      stage: 'Lower Manhattan',
      run: ({ map, setShowRisk, setShowMovement, setSelectedBin, setPanelOpen }) => {
        setShowRisk(false);
        setShowMovement(false);
        setSelectedBin(null);
        setPanelOpen(false);
        map.jumpTo({ ...START, padding: NO_PADDING });
        map.flyTo({ ...APPROACH, duration: duration(5000), curve: 1.15, essential: false });
      },
    },
    {
      at: 5000,
      stage: 'Inspection-priority scores',
      run: ({ map, setShowRisk }) => {
        setShowRisk(true);
        map.easeTo({ bearing: APPROACH.bearing + 12, zoom: APPROACH.zoom + 0.25, duration: duration(4800), easing: smooth, essential: false });
      },
    },
    {
      at: 10_000,
      stage: 'Highest-priority building',
      run: ({ map, target, setSelectedBin, later }) => {
        if (!target) return;
        const zoom = target.height_m > 120 ? 15.8 : 16.25;
        map.flyTo({ center: target.center, zoom, pitch: 60, bearing: 36, duration: duration(5500), curve: 1.15, essential: false });
        later(() => setSelectedBin(target.bin), 4200);
      },
    },
    {
      at: 17_000,
      stage: 'The evidence behind the priority',
      run: ({ map, target, setPanelOpen }) => {
        setPanelOpen(true);
        if (!target) return;
        map.easeTo({
          center: target.center,
          bearing: 48,
          padding: demoPadding(map.getContainer().clientWidth, map.getContainer().clientHeight),
          duration: duration(6000),
          easing: smooth,
          essential: false,
        });
      },
    },
    {
      at: 24_000,
      stage: 'From evidence to inspection priorities',
      run: ({ map }) => {
        map.flyTo({ ...FINALE, padding: demoPadding(map.getContainer().clientWidth, map.getContainer().clientHeight), duration: duration(5800), curve: 1.15, essential: false });
      },
    },
  ];
}

export function useDemoRunner(getActions: () => Omit<DemoActions, 'later'> | null) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stage, setStage] = useState('');
  const timers = useRef<number[]>([]);
  const clock = useRef<number | undefined>(undefined);
  const runningRef = useRef(false);

  const clear = () => {
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
  }, [getActions]);

  const start = useCallback(() => {
    const actions = getActions();
    if (!actions) return;
    clear();
    runningRef.current = true;
    setRunning(true);
    setElapsed(0);

    const schedule = (fn: () => void, ms: number) => {
      timers.current.push(window.setTimeout(() => runningRef.current && fn(), ms));
    };
    const ctx: DemoActions = { ...actions, later: schedule };
    for (const step of demoTimeline()) {
      schedule(() => {
        setStage(step.stage);
        step.run(ctx);
      }, step.at);
    }
    schedule(() => {
      runningRef.current = false;
      setRunning(false);
      window.clearInterval(clock.current);
      setElapsed(DEMO_DURATION_MS);
    }, DEMO_DURATION_MS);

    const t0 = performance.now();
    // Only the text clock needs React updates. The progress line animates in CSS.
    clock.current = window.setInterval(() => {
      if (runningRef.current) setElapsed(Math.min(DEMO_DURATION_MS, performance.now() - t0));
    }, 1000);
  }, [getActions]);

  useEffect(() => clear, []);

  return { running, elapsed, stage, start, stop };
}

export interface DemoControllerProps {
  running: boolean;
  elapsed: number;
  stage: string;
  onStop: () => void;
}

/** Progress strip shown along the bottom while Demo Mode runs. */
export function DemoController({ running, elapsed, stage, onStop }: DemoControllerProps) {
  if (!running) return null;
  return (
    <div className="demo-strip" role="status" aria-live="polite">
      <div className="demo-strip__row">
        <span className="demo-strip__dot" aria-hidden />
        <span className="demo-strip__label">Demo</span>
        <span className="demo-strip__stage">{stage}</span>
        <span className="demo-strip__time">{(elapsed / 1000).toFixed(0).padStart(2, '0')}s / 30s</span>
        <button type="button" className="demo-strip__stop" onClick={onStop}>
          Stop <kbd>Esc</kbd>
        </button>
      </div>
      <div className="demo-strip__track">
        <div className="demo-strip__fill" style={{ animationDuration: `${DEMO_DURATION_MS}ms` }} />
      </div>
    </div>
  );
}
