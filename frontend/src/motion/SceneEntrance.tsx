import { useEffect } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import { INITIAL_VIEW } from '../camera';
import { CITY_RISE_MS, CITY_SWEEP_MS, CITY_COLOR_AT_MS, cityScale, smoothstep, type SceneTransform } from './sceneMotion';

export const ENTRANCE_VIEW = { ...INITIAL_VIEW, zoom: 13.1, pitch: 36, bearing: -16 };

export function SceneEntrance({ ready, active, transform, onFinish, onReveal, sweepCamera = true }: {
  ready: boolean; active: boolean; transform: SceneTransform; onFinish: () => void; onReveal: () => void; sweepCamera?: boolean;
}) {
  const { current } = useMap();
  useEffect(() => {
    const map = current?.getMap();
    if (!map || !ready || !active) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, swept = false, revealed = false;
    const start = performance.now();
    transform.scale = cityScale(0);
    const finish = () => { transform.scale = 1; onFinish(); };
    const tick = (now: number) => {
      const elapsed = now - start;
      transform.scale = cityScale(elapsed);
      if (sweepCamera && !swept && elapsed >= CITY_RISE_MS) {
        swept = true;
        map.flyTo({ center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude], zoom: INITIAL_VIEW.zoom,
          pitch: INITIAL_VIEW.pitch, bearing: INITIAL_VIEW.bearing, duration: CITY_SWEEP_MS, curve: 1.1, easing: smoothstep });
      }
      if (sweepCamera && !revealed && elapsed >= CITY_COLOR_AT_MS) { revealed = true; onReveal(); }
      if (elapsed >= CITY_RISE_MS + (sweepCamera ? CITY_SWEEP_MS : 0)) finish();
      else frame = requestAnimationFrame(tick);
    };
    const skip = () => { map.stop(); finish(); };
    const hide = () => { if (document.hidden) skip(); };
    if (reduced.matches) skip(); else frame = requestAnimationFrame(tick);
    reduced.addEventListener('change', skip);
    document.addEventListener('visibilitychange', hide);
    return () => {
      cancelAnimationFrame(frame);
      reduced.removeEventListener('change', skip);
      document.removeEventListener('visibilitychange', hide);
      transform.scale = 1;
      // Do not stop a replacement camera animation started by a building click or demo.
    };
  }, [current, ready, active, transform, onFinish, onReveal, sweepCamera]);
  return null;
}
