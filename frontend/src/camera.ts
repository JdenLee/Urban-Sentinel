/** [west, south, east, north] of the scored demo area (matches scripts/prepare-buildings.mjs). */
export const DEMO_BBOX: [number, number, number, number] = [-74.022, 40.7, -73.97, 40.735];

export interface CameraStop {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

/** Angled 3D view over Lower Manhattan, looking up the island. */
export const INITIAL_VIEW = {
  longitude: -74.004,
  latitude: 40.708,
  zoom: 14.15,
  pitch: 58,
  bearing: 29,
};

export const INITIAL_CAMERA: CameraStop = {
  center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
  zoom: INITIAL_VIEW.zoom,
  pitch: INITIAL_VIEW.pitch,
  bearing: INITIAL_VIEW.bearing,
};

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}
