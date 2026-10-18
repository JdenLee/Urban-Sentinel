import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { adaptBasemapStyle } from './basemapStyle';

const style: StyleSpecification = {
  version: 8,
  sources: { tiles: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] } },
  layers: [
    { id: 'background', type: 'background' },
    { id: 'flat-buildings', type: 'fill', source: 'tiles', 'source-layer': 'building' },
    { id: 'towers', type: 'fill-extrusion', source: 'tiles', 'source-layer': 'building' },
    { id: 'other-extrusions', type: 'fill-extrusion', source: 'tiles', 'source-layer': 'structures' },
    { id: 'roads', type: 'line', source: 'tiles', 'source-layer': 'transportation' },
    { id: 'labels', type: 'symbol', source: 'tiles', 'source-layer': 'place' },
    { id: 'unsupported-pattern', type: 'fill', source: 'tiles', 'source-layer': 'landuse', paint: { 'fill-pattern': 'missing' } },
  ],
};

describe('basemap building occlusion regression', () => {
  it('leaves no visible basemap building geometry or added gray extrusions', () => {
    const result = adaptBasemapStyle(style);
    const visible = result.layers.filter((layer) => layer.layout?.visibility !== 'none');
    expect(visible.map((layer) => layer.id)).toEqual(['background', 'roads', 'labels']);
    expect(visible.some((layer) => layer.type === 'fill-extrusion')).toBe(false);
  });

  it('preserves roads, labels and the original style without mutation', () => {
    const before = JSON.stringify(style);
    const result = adaptBasemapStyle(style);
    expect(result.sources).toEqual(style.sources);
    expect(result.layers.find((layer) => layer.id === 'roads')).toEqual(style.layers[4]);
    expect(result.layers.find((layer) => layer.id === 'labels')).toEqual(style.layers[5]);
    expect(JSON.stringify(style)).toBe(before);
  });
});
