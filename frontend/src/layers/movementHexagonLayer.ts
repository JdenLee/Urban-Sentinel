import { HexagonLayer } from '@deck.gl/aggregation-layers';
import type { DataMode, JoinedFeature } from '../types/predictions';
import { featureCentroid } from '../data/joinByBin';

export interface MovementPointDatum {
  position: [number, number];
  /** Absolute line-of-sight velocity, mm/yr. */
  speed: number;
}

/** Deterministic 0..1 hash of a BIN so background points are stable between reloads. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Build point samples for the satellite-movement aggregation.
 * Scored buildings contribute their `sar_velocity_mm_year` factor. In mock mode every other
 * footprint also contributes a small, deterministic background velocity so the field reads as
 * continuous coverage; real data never gets synthetic points.
 */
export function movementPoints(features: JoinedFeature[], mode: DataMode): MovementPointDatum[] {
  const out: MovementPointDatum[] = [];
  for (const f of features) {
    const v = f.properties.prediction?.factors.sar_velocity_mm_year;
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.push({ position: featureCentroid(f), speed: Math.abs(v) });
    } else if (mode === 'mock') {
      out.push({ position: featureCentroid(f), speed: 0.3 + 1.6 * hash01(f.properties.bin) ** 2 });
    }
  }
  return out;
}

/** Purple → magenta → white: deliberately disjoint from the blue/yellow/orange/red priority ramp. */
export const MOVEMENT_COLORS: [number, number, number][] = [
  [38, 22, 74],
  [84, 36, 132],
  [140, 52, 170],
  [199, 80, 190],
  [240, 140, 220],
  [255, 220, 250],
];
/** Colour domain, mm/yr of absolute LOS velocity. */
export const MOVEMENT_DOMAIN: [number, number] = [0.4, 5];

export function movementHexagonLayer(points: MovementPointDatum[], visible: boolean, radius = 60) {
  return new HexagonLayer<MovementPointDatum>({
    id: 'satellite-movement',
    data: points,
    visible,
    radius,
    coverage: 0.86,
    extruded: true,
    elevationScale: visible ? 1 : 0,
    getPosition: (d) => d.position,
    getColorWeight: (d) => d.speed,
    colorAggregation: 'MEAN',
    getElevationWeight: (d) => d.speed,
    elevationAggregation: 'MEAN',
    colorRange: MOVEMENT_COLORS,
    colorDomain: MOVEMENT_DOMAIN,
    elevationDomain: [0, 8],
    elevationRange: [2, 40],
    opacity: 0.5,
    material: { ambient: 0.6, diffuse: 0.5, shininess: 8 },
    pickable: false,
    transitions: { elevationScale: { duration: 1800 } },
  });
}
