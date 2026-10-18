export const CITY_RISE_MS = 2300;
export const CITY_SWEEP_MS = 3600;
/** Reveal during the approach, finishing before the camera reaches its first view. */
export const CITY_COLOR_AT_MS = CITY_RISE_MS + 900;
export const CITY_COLOR_FADE_MS = 2200;
/** Shared by ordinary footprints and landmark crowns during the neutral opening. */
export const CITY_OPENING_GRAY: [number, number, number, number] = [180, 180, 180, 255];
export const PIN_DROP_MS = 900;
export const PIN_SETTLE_MS = 800;
export const PIN_HOVER_MS = 2800;

export interface SceneTransform { scale: number; offset: number }
export const smoothstep = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
export const cityScale = (elapsed: number) => Math.max(.001, smoothstep(elapsed / CITY_RISE_MS));
/** Soft landing bounce, then a small looping hover; all joins have zero velocity. */
export const pinOffset = (elapsed: number) => {
  if (elapsed <= PIN_DROP_MS) return 160 * (1 - smoothstep(elapsed / PIN_DROP_MS));
  const afterDrop = elapsed - PIN_DROP_MS;
  if (afterDrop < PIN_SETTLE_MS) return 6 * Math.sin(Math.PI * afterDrop / PIN_SETTLE_MS) ** 2;
  return 2.5 * (1 - Math.cos(2 * Math.PI * (afterDrop - PIN_SETTLE_MS) / PIN_HOVER_MS));
};
