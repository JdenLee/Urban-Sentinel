import { describe, expect, it } from 'vitest';
import type { GeoJsonLayer, SolidPolygonLayer } from '@deck.gl/layers';
import type { JoinedFeature } from '../types/predictions';
import { buildingRiskLayers, type BuildingLayerOptions } from '../layers/buildingRiskLayer';
import { CITY_OPENING_GRAY, CITY_COLOR_FADE_MS } from '../motion/sceneMotion';
import { sunState } from './sunPosition';
import { PRIORITY_COLOR } from './priority';
import type { LandmarkFace } from './landmarkGeometry';

const feature = (bin: string, scored = false): JoinedFeature => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[-74.01, 40.71], [-74.009, 40.71], [-74.009, 40.711], [-74.01, 40.71]]] },
  properties: { bin, height_m: 50, prediction: scored ? { priority: 'critical', rank: 1 } : null },
}) as JoinedFeature;
const scored = feature('1234567', true), context = feature('7654321'), landmark = feature('1001018');
const options: BuildingLayerOptions = {
  context: [context, landmark], scored: [scored], showRisk: true, selectedBin: null,
  visiblePriorities: new Set(['critical', 'high', 'medium', 'low']), capacityCutoff: null,
  rise: { scale: .5, offset: 0 }, pin: { scale: 1, offset: 0 },
  sun: sunState(new Date('2026-10-18T16:00:00Z'), 40.71, -74.01),
};
const color = (layer: GeoJsonLayer, f: JoinedFeature) =>
  (layer.props.getFillColor as unknown as (f: JoinedFeature) => number[])(f);

describe('neutral opening layers', () => {
  it('forces context, predictions and landmark crowns to gray without fading from old colours', () => {
    const layers = buildingRiskLayers({ ...options, grayOpening: true });
    for (const [id, f] of [['context-buildings', context], ['scored-buildings', scored]] as const) {
      const layer = layers.find((l) => l.id === id) as GeoJsonLayer;
      expect(color(layer, f)).toEqual(CITY_OPENING_GRAY);
      expect(layer.props.transitions).toMatchObject({ getFillColor: { duration: 1 } });
      expect(layer.props).toMatchObject({ facadeDetail: 0, sceneTransform: options.rise });
    }
    const tower = layers.find((l) => l.id === 'landmark-1001018') as SolidPolygonLayer<LandmarkFace>;
    const crown = [...tower.props.data as LandmarkFace[]].find((d) => d.crown)!;
    const rgb = (tower.props.getFillColor as unknown as (d: LandmarkFace) => number[])(crown);
    expect(rgb[0]).toBe(rgb[1]);
    expect(rgb[1]).toBe(rgb[2]);
    expect(tower.props.transitions).toMatchObject({ getFillColor: { duration: 1 } });
  });

  it('restores priority colours with a smooth fade and preserves the risk-off control', () => {
    const layers = buildingRiskLayers({ ...options, grayOpening: false });
    const layer = layers.find((l) => l.id === 'scored-buildings') as GeoJsonLayer;
    expect(color(layer, scored)).toEqual([...PRIORITY_COLOR.critical, 255]);
    expect(layer.props.transitions).toMatchObject({ getFillColor: { duration: CITY_COLOR_FADE_MS } });
    expect(layer.props).toMatchObject({ facadeDetail: 1 });
    const off = buildingRiskLayers({ ...options, grayOpening: false, showRisk: false }).find((l) => l.id === layer.id) as GeoJsonLayer;
    expect(color(off, scored)).not.toEqual([...PRIORITY_COLOR.critical, 255]);
  });
});
