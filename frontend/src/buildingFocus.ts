import type { Map as MapLibreMap } from 'maplibre-gl';
import { prefersReducedMotion } from './camera';

/** Fly to a selection, then make one slow quarter-turn around it. Returns an interrupt handler. */
export function focusBuilding(map: MapLibreMap, center: [number, number], height = 0): () => void {
  const reduced = prefersReducedMotion();
  const { clientWidth: width, clientHeight: viewportHeight } = map.getContainer();
  const mobile = width <= 760;
  const tall = height > 300;
  const padding = mobile
    ? { top: Math.round(viewportHeight * 0.24), bottom: Math.round(viewportHeight * 0.58), left: 20, right: 20 }
    : { top: tall ? 180 : 76, bottom: 64, left: width > 1100 ? 332 : 24, right: width > 1100 ? 412 : 372 };
  const zoom = (tall ? 15.05 : height > 120 ? 15.7 : 16.6) - (mobile ? 0.9 : 0);
  let active = !reduced;

  const finish = () => {
    active = false;
    map.off('moveend', finish);
  };
  const orbit = () => {
    map.off('moveend', orbit);
    if (!active) return;
    map.on('moveend', finish);
    map.easeTo({ center, bearing: map.getBearing() + 90, duration: 12_000,
      easing: (t) => t * t * (3 - 2 * t), essential: false });
  };

  // Stop any preceding camera operation before registering the arrival listener: stop emits moveend.
  map.stop();
  if (!reduced) map.on('moveend', orbit);
  map.flyTo({ center, zoom, pitch: tall ? 52 : 60, padding, duration: reduced ? 0 : 2200, essential: false });

  return () => {
    map.off('moveend', orbit);
    map.off('moveend', finish);
    const wasActive = active;
    active = false;
    if (wasActive) map.stop();
  };
}
