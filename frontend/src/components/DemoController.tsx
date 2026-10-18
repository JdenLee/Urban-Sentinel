import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { CameraStop } from '../camera';
import { prefersReducedMotion } from '../camera';

export const DEMO_DURATION_MS = 30_000;
const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

export function demoPadding(width: number, height: number) {
  if (width <= 760) return { top: 60, bottom: Math.round(height * 0.58), left: 20, right: 20 };
  return { top: 76, bottom: 64, left: width > 1100 ? 332 : 24, right: width > 1100 ? 412 : 372 };
}

export type DemoMotion = 'cinematic' | 'reduced';

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

// Original PR #3 camera route: wide approach, sweeping orbit, close-up, then pull back.
const START: CameraStop = { center: [-73.99, 40.7], zoom: 12.3, pitch: 25, bearing: -12 };
const APPROACH: CameraStop = { center: [-74.004, 40.712], zoom: 14.5, pitch: 58, bearing: 24 };
const FINALE: CameraStop = { center: [-74.0005, 40.7165], zoom: 14.25, pitch: 62, bearing: 8 };

const smooth = (t: number) => t * t * (3 - 2 * t);

/** The fixed 30-second script. Every call returns the same steps with the same timings. */
export function demoTimeline(motion: DemoMotion = prefersReducedMotion() ? 'reduced' : 'cinematic'): DemoStep[] {
  const animate = motion === 'cinematic';
  const duration = (ms: number) => animate ? ms : 0;
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
        map.flyTo({ ...APPROACH, duration: duration(5000), curve: 1.25, essential: animate });
      },
    },
    {
      at: 5000,
      stage: 'Inspection-priority scores',
      run: ({ map, setShowRisk }) => {
        setShowRisk(true);
        map.easeTo({ bearing: APPROACH.bearing + 22, zoom: APPROACH.zoom + 0.35, duration: duration(5000), easing: smooth, essential: animate });
      },
    },
    {
      at: 10_000,
      stage: 'Highest-priority building',
      run: ({ map, target, setSelectedBin, later }) => {
        if (!target) return;
        const zoom = target.height_m > 300 ? 15.05 : target.height_m > 120 ? 16.1 : 16.7;
        map.flyTo({ center: target.center, zoom, pitch: 63, bearing: 78, duration: duration(5500), curve: 1.4, essential: animate });
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
          bearing: 104,
          padding: demoPadding(map.getContainer().clientWidth, map.getContainer().clientHeight),
          duration: duration(7000),
          easing: smooth,
          essential: animate,
        });
      },
    },
    {
      at: 24_000,
      stage: 'From evidence to inspection priorities',
      run: ({ map }) => {
        map.flyTo({ ...FINALE, padding: demoPadding(map.getContainer().clientWidth, map.getContainer().clientHeight), duration: duration(5800), curve: 1.2, essential: animate });
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

  // Starting the cinematic tour is an explicit request for camera motion. Other navigation still
  // respects the OS preference, and the adjacent reduced-motion action uses instant camera cuts.
  const start = useCallback((motion: DemoMotion = 'cinematic') => {
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
    for (const step of demoTimeline(motion)) {
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
