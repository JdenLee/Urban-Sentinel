import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANDMARKS, buildingName, searchLandmarks } from './landmarks';
import { parseBuildings } from './loadBuildings';
import { joinByBin } from './joinByBin';
import { parsePredictions } from './loadPredictions';
import { combineSearchResults } from './shortlist';
import { oneWtcGeometry, WTC_ROOF_M, WTC_SPIRE_M } from './landmarkGeometry';
import { landmarkLayers, pickedBuilding } from '../layers/landmarkLayer';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../public/data/${name}`, import.meta.url), 'utf8'));
const buildings = parseBuildings(read('buildings-demo.geojson'));
const predictions = parsePredictions({ schema_version: '1', data_mode: 'real', buildings: [] });
const join = joinByBin(buildings, predictions);
const wtc = join.features.find((f) => f.properties.bin === '1088469')!;

describe('landmark identity without fabricated scores', () => {
  it('uses unique BINs that all resolve to the prepared footprint dataset', () => {
    expect(new Set(LANDMARKS.map((l) => l.bin)).size).toBe(LANDMARKS.length);
    for (const l of LANDMARKS) expect(join.features.some((f) => f.properties.bin === l.bin)).toBe(true);
  });

  it('finds unscored One WTC by popular aliases and keeps its prediction absent', () => {
    for (const name of ['Freedom Tower', 'One WTC', 'world trade center']) {
      expect(searchLandmarks(join.features, name).map((f) => f.properties.bin)).toContain(wtc.properties.bin);
    }
    expect(wtc.properties.prediction).toBeNull();
    expect(join.scored).toHaveLength(0);
    expect(buildingName('1088469', '185 Greenwich Street')).toBe('One World Trade Center');
    expect(buildingName('1234567', '123 Broadway')).toBe('123 Broadway');
  });

  it('does not duplicate a landmark that also appears in an address or local result', () => {
    const results = combineSearchResults([wtc], [{ bin: '1088469', label: '1 World Trade Center', lonLat: [-74.01317, 40.71301], borough: 'Manhattan' }], 'World Trade Center', 10, [wtc]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'landmark', bin: '1088469', label: 'One World Trade Center' });
  });
});

describe('illustrative One WTC geometry', () => {
  it('has a faceted body, a roof below the spire, and only finite coordinates', () => {
    const g = oneWtcGeometry(wtc);
    const body = g.faces.flatMap((f) => f.polygon);
    expect(Math.max(...body.map((p) => p[2]))).toBe(WTC_ROOF_M);
    expect(Math.max(...g.spire.flatMap((l) => l.path.map((p) => p[2])))).toBe(WTC_SPIRE_M);
    expect(g.faces.filter((f) => f.polygon.length === 3)).toHaveLength(8);
    expect(body.every((p) => p.every(Number.isFinite))).toBe(true);
    expect(g.glazing.every((line) => line.path.every((p) => p.every(Number.isFinite)))).toBe(true);
  });

  it('preserves the source footprint/score and resolves model-face clicks to its BIN', () => {
    const before = JSON.stringify(wtc);
    const g = oneWtcGeometry(wtc);
    expect(JSON.stringify(wtc)).toBe(before);
    expect(pickedBuilding(g.faces[0])).toBe(wtc);
    expect(pickedBuilding(wtc)).toBe(wtc);
    expect(pickedBuilding({ unrelated: true })).toBeUndefined();
  });

  it('visibly highlights an unscored landmark without changing its prediction or picking identity', () => {
    const neutral = landmarkLayers([wtc], null, () => [255, 0, 0, 255])[0];
    const selected = landmarkLayers([wtc], wtc.properties.bin, () => [255, 0, 0, 255])[0];
    const face = oneWtcGeometry(wtc).faces[0];
    const color = (layer: typeof selected) => (layer.props as unknown as { getFillColor: (datum: typeof face) => number[] }).getFillColor(face);
    expect(color(selected)).not.toEqual(color(neutral));
    expect(wtc.properties.prediction).toBeNull();
    expect(pickedBuilding(face)?.properties.bin).toBe(wtc.properties.bin);
  });
});
