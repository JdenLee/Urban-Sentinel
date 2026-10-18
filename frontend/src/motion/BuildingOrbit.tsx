import { useEffect } from 'react';
import { useMap } from 'react-map-gl/maplibre';

/** Frame-rate-independent, deliberately slow; discard long gaps after backgrounding. */
export function orbitStep(bearing: number, elapsedMs: number): number {
  return bearing + Math.max(0, Math.min(100, elapsedMs)) * 0.0025;
}

export function BuildingOrbit({ enabled, subject }: { enabled: boolean; subject: string | null }) {
  const { current } = useMap();
  useEffect(() => {
    const map = current?.getMap();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!map || !enabled || !subject) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = now - last;
      last = now;
      // Let the selection fly-in finish before orbiting. Jumping bearing preserves its framing.
      if (!document.hidden && !reduced.matches && !map.isMoving()) {
        map.jumpTo({ bearing: orbitStep(map.getBearing(), elapsed) });
      }
      frame = requestAnimationFrame(tick);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      last = performance.now();
      if (!reduced.matches) frame = requestAnimationFrame(tick);
    };
    schedule();
    reduced.addEventListener('change', schedule);
    return () => { cancelAnimationFrame(frame); reduced.removeEventListener('change', schedule); };
  }, [current, enabled, subject]);
  return null;
}
