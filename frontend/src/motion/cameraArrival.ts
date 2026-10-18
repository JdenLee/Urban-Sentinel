import type { Map as MapLibreMap } from 'maplibre-gl';

/** Register after stopping the previous move, before starting the next one (including duration 0). */
export function afterCameraArrival(map: MapLibreMap, onArrival: () => void): () => void {
  let active = true;
  const cancel = () => { active = false; map.off('moveend', arrived); };
  const arrived = () => {
    if (!active) return;
    cancel();
    onArrival();
  };
  map.on('moveend', arrived);
  return cancel;
}
