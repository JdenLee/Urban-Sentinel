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
  it('uses blue water without removing required data attribution', () => {
    const result = adaptBasemapStyle({
      ...style,
      sources: { tiles: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'],
        attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> | <a href="https://openmaptiles.org">© OpenMapTiles</a> Data from <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>' } },
      layers: [...style.layers, { id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water' }],
    });
    const water = result.layers.find((l) => l.id === 'water');
    expect(water?.type === 'fill' && water.paint?.['fill-color']).toBe('#91b8c8');
    expect(JSON.stringify(result.sources)).not.toContain('OpenFreeMap');
    expect(JSON.stringify(result.sources)).toContain('OpenMapTiles');
    expect(JSON.stringify(result.sources)).toContain('OpenStreetMap');
  });
  it('leaves no visible basemap building geometry or added gray extrusions', () => {
    const result = adaptBasemapStyle(style);
    const visible = result.layers.filter((layer) => layer.layout?.visibility !== 'none');
    expect(visible.map((layer) => layer.id)).toEqual(['background', 'roads']);
    expect(visible.some((layer) => layer.type === 'fill-extrusion')).toBe(false);
  });

  it('preserves roads and the original style, while hiding cluttering labels', () => {
    const before = JSON.stringify(style);
    const result = adaptBasemapStyle(style);
    expect(result.sources).toEqual(style.sources);
    expect(result.layers.find((layer) => layer.id === 'roads')).toEqual(style.layers[4]);
    expect(result.layers.find((layer) => layer.id === 'labels')?.layout?.visibility).toBe('none');
    expect(JSON.stringify(style)).toBe(before);
  });
});
