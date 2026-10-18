import type { JoinedFeature } from '../types/predictions';
import { featureCentroid } from './joinByBin';

export type Position3 = [number, number, number];
export interface LandmarkFace { polygon: Position3[]; shade: number; feature: JoinedFeature; crown?: boolean }
export interface LandmarkLine { path: Position3[] }
export const WTC_ROOF_M = 417.1;
export const WTC_SPIRE_M = 541.3;
const PODIUM_M = 62;

const interpolate = (a: Position3, b: Position3, t: number): Position3 => a.map((v, i) => v + (b[i] - v) * t) as Position3;

/**
 * Illustrative silhouettes, NOT surveyed architecture. Heights come from the Skyscraper Museum;
 * tier widths/heights are visual approximations. The original NYC footprint remains untouched.
 * Actual LoD2 meshes can replace these without changing building identity or model data.
 */
export function setbackGeometry(feature: JoinedFeature, kind: 'woolworth' | '40-wall') {
  const center = featureCentroid(feature);
  const ring = (feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates[0][0]).slice(0, -1);
  const total = kind === 'woolworth' ? 241.4 : 282.6;
  const tiers = kind === 'woolworth'
    ? [[0, 1], [.40, 1], [.40, .58], [.76, .58], [.76, .47], [.88, .47], [.88, .36], [1, .04]]
    : [[0, 1], [.23, 1], [.23, .84], [.39, .84], [.39, .66], [.58, .66], [.58, .48], [.82, .48], [.82, .35], [.90, .35], [1, .025]];
  const faces: LandmarkFace[] = [], edges: LandmarkLine[] = [], glazing: LandmarkLine[] = [];
  const level = (height: number, scale: number) => ring.map(([x, y]): Position3 => [center[0] + (x - center[0]) * scale, center[1] + (y - center[1]) * scale, height * total]);
  for (let t = 1; t < tiers.length; t++) {
    const a = level(...tiers[t - 1] as [number, number]), b = level(...tiers[t] as [number, number]);
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      faces.push({ polygon: [a[i], a[j], b[j], b[i]], shade: .78 + (i % 4) * .07, feature, crown: t === tiers.length - 1 });
      if (a[i][2] === b[i][2]) edges.push({ path: [b[i], b[j]] });
      else for (let z = a[i][2] + 3.8; z < b[i][2]; z += 3.8) {
        const u = (z - a[i][2]) / (b[i][2] - a[i][2]);
        glazing.push({ path: [interpolate(a[i], b[i], u), interpolate(a[j], b[j], u)] });
      }
    }
  }
  faces.push({ polygon: level(1, .025), shade: 1, feature, crown: true });
  return { faces, edges, glazing, spire: [] as LandmarkLine[] };
}

/** Illustrative SOM-inspired massing, anchored to the NYC footprint; not a surveyed mesh. */
export function oneWtcGeometry(feature: JoinedFeature) {
  const ring = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates[0][0];
  const center = featureCentroid(feature);
  const corners = ring.slice(0, 4).map(([x, y]): Position3 => [x, y, PODIUM_M]);
  const mx = 111320 * Math.cos(center[1] * Math.PI / 180);
  const my = 111320;
  // SOM describes a roof square 150 feet wide, rotated 45 degrees from the base.
  const roof = corners.map((corner, i): Position3 => {
    const midpoint = interpolate(corner, corners[(i + 1) % 4], 0.5);
    const dx = (midpoint[0] - center[0]) * mx;
    const dy = (midpoint[1] - center[1]) * my;
    const scale = (45.72 / Math.sqrt(2)) / Math.hypot(dx, dy);
    return [center[0] + dx * scale / mx, center[1] + dy * scale / my, WTC_ROOF_M];
  });
  const faces: LandmarkFace[] = [];
  const edges: LandmarkLine[] = [];
  const glazing: LandmarkLine[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    faces.push({ polygon: [[corners[i][0], corners[i][1], 0], [corners[j][0], corners[j][1], 0], corners[j], corners[i]], shade: 0.76 + i * 0.055, feature });
    const triangles = [[corners[i], corners[j], roof[i]], [roof[i], roof[j], corners[j]]];
    for (const [t, polygon] of triangles.entries()) {
      faces.push({ polygon, shade: [0.8, 1.08, 0.93, 0.7][i] + t * 0.07, feature });
      edges.push({ path: [...polygon, polygon[0]] });
      // Level lines follow the taper rather than floating over an extruded box.
      for (let z = PODIUM_M + 4; z < WTC_ROOF_M; z += 4.1) {
        const intersections: Position3[] = [];
        for (let k = 0; k < 3; k++) {
          const a = polygon[k], b = polygon[(k + 1) % 3];
          if (z > Math.min(a[2], b[2]) && z < Math.max(a[2], b[2])) intersections.push(interpolate(a, b, (z - a[2]) / (b[2] - a[2])));
        }
        if (intersections.length === 2) glazing.push({ path: intersections });
      }
    }
  }
  faces.push({ polygon: roof, shade: 1.13, feature });
  const spire: LandmarkLine[] = [{ path: [[...center, WTC_ROOF_M], [...center, WTC_SPIRE_M]] }];
  for (const corner of roof) spire.push({ path: [corner, [...center, 475]] });
  for (const z of [425, 432, 440]) {
    const radius = z === 425 ? 13 : 8;
    spire.push({ path: Array.from({ length: 25 }, (_, i): Position3 => [center[0] + Math.cos(i * Math.PI / 12) * radius / mx, center[1] + Math.sin(i * Math.PI / 12) * radius / my, z]) });
  }
  // Offset linework slightly from the glass to avoid coplanar depth flicker.
  for (const line of [...edges, ...glazing]) {
    line.path = line.path.map(([x, y, z]) => [center[0] + (x - center[0]) * 1.01, center[1] + (y - center[1]) * 1.01, z]);
  }
  return { faces, edges, glazing, spire };
}
