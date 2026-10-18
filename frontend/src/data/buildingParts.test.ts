import { describe, expect, it } from 'vitest';
import { parseBuildings } from './loadBuildings';
import { joinByBin } from './joinByBin';
import { parsePredictions } from './loadPredictions';
import { renderParts } from './buildingParts';
const geometry = { type: 'Polygon', coordinates: [[[-74, 40.7], [-74.001, 40.7], [-74.001, 40.701], [-74, 40.7]]] };
describe('multi-part source geometry', () => {
  it('preserves individual heights while ranking and selecting by one BIN', () => {
    const source = parseBuildings({ type: 'FeatureCollection', features: [{
      type: 'Feature', geometry,
      properties: { bin: '1000001', height_m: 60, parts: [{ geometry, height_m: 60 }, { geometry, height_m: 18 }] },
    }] });
    const joined = joinByBin(source, parsePredictions({ schema_version: '1', buildings: [{ bin: '1000001', score: .7 }], data_mode: 'real' }));
    expect(joined.scored).toHaveLength(1);
    const parts = renderParts(joined.scored[0]);
    expect(parts.map((p) => p.properties.height_m)).toEqual([60, 18]);
    expect(parts.every((p) => p.properties.bin === '1000001' && p.properties.prediction === joined.scored[0].properties.prediction)).toBe(true);
  });
  it('keeps old footprint exports backward compatible', () => {
    const source = parseBuildings({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: { bin: '1000001', height_m: 20 } }] });
    const feature = joinByBin(source, parsePredictions({ schema_version: '1', data_mode: 'real', buildings: [] })).features[0];
    expect(renderParts(feature)).toEqual([feature]);
  });
});
