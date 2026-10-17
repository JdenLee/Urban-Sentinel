import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HEIGHT_M, joinByBin } from './joinByBin';
import { parseBuildings } from './loadBuildings';
import { binString, parsePredictions } from './loadPredictions';
import { normalisePriority, priorityFromScore, PRIORITY_RANGE } from './priority';
import { searchScored, shortlistCsv } from './shortlist';
import { movementPoints } from '../layers/movementHexagonLayer';
import { demoTimeline, DEMO_DURATION_MS } from '../components/DemoController';

const square = (x: number, y: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y + 0.001], [x, y]]],
});

const footprints = (rows: { bin: unknown; height_m?: unknown; address?: string }[]) =>
  parseBuildings({
    type: 'FeatureCollection',
    features: rows.map((r, i) => ({
      type: 'Feature',
      properties: { bin: r.bin, height_m: r.height_m, address: r.address ?? null },
      geometry: square(-74 + i * 0.002, 40.7),
    })),
  });

const contract = (buildings: unknown[], extra: Record<string, unknown> = {}) =>
  parsePredictions({
    schema_version: '1.0',
    data_mode: 'mock',
    model: { name: 'm', version: 'v', execution_platform: 'IBM LinuxONE' },
    buildings,
    ...extra,
  });

describe('priorityFromScore', () => {
  it('applies the default thresholds at their boundaries', () => {
    expect(priorityFromScore(0.85)).toBe('critical');
    expect(priorityFromScore(0.8499)).toBe('high');
    expect(priorityFromScore(0.7)).toBe('high');
    expect(priorityFromScore(0.6999)).toBe('medium');
    expect(priorityFromScore(0.45)).toBe('medium');
    expect(priorityFromScore(0.4499)).toBe('low');
    expect(priorityFromScore(0)).toBe('low');
    expect(priorityFromScore(1)).toBe('critical');
  });

  it('maps ML service tiers onto display categories', () => {
    expect(normalisePriority('elevated', true)).toBe('high');
    expect(normalisePriority('high', true)).toBe('critical');
    expect(normalisePriority('Critical')).toBe('critical');
    expect(normalisePriority('nonsense')).toBeNull();
  });
});

describe('BIN handling', () => {
  it('keeps BIN as a string and normalises numeric input', () => {
    expect(binString(1000010)).toBe('1000010');
    expect(binString('1000010')).toBe('1000010');
    expect(binString('1000010.0')).toBe('1000010');
    expect(binString('10000')).toBeNull();
    expect(binString(null)).toBeNull();
  });

  it('joins numeric footprint BINs to string prediction BINs', () => {
    const b = footprints([{ bin: 1000010, height_m: 40 }]);
    expect(typeof b.features[0].properties.bin).toBe('string');
    const p = contract([{ bin: '1000010', score: 0.5 }]);
    const j = joinByBin(b, p);
    expect(j.scored).toHaveLength(1);
    expect(j.scored[0].properties.bin).toBe('1000010');
  });

  it('does not match BINs that differ only by leading zeros or type coercion', () => {
    const b = footprints([{ bin: '1000010' }]);
    const p = contract([{ bin: '1000011', score: 0.9 }]);
    expect(joinByBin(b, p).scored).toHaveLength(0);
  });
});

describe('joinByBin', () => {
  it('joins footprints and predictions by BIN', () => {
    const b = footprints([
      { bin: '1000001', height_m: 30 },
      { bin: '1000002', height_m: 50 },
      { bin: '1000003', height_m: 20 },
    ]);
    const p = contract([
      { bin: '1000002', score: 0.91, rank: 1 },
      { bin: '1000003', score: 0.3, rank: 2 },
      { bin: '1999999', score: 0.5, rank: 3 },
    ]);
    const j = joinByBin(b, p);
    expect(j.features).toHaveLength(3);
    expect(j.scored.map((f) => f.properties.bin)).toEqual(['1000002', '1000003']);
    expect(j.features[0].properties.prediction).toBeNull();
    expect(j.scored[0].properties.prediction?.priority).toBe('critical');
    expect(j.unmatchedPredictions.map((x) => x.bin)).toEqual(['1999999']);
  });

  it('handles an empty prediction set (all buildings unscored)', () => {
    const j = joinByBin(footprints([{ bin: '1000001' }]), contract([]));
    expect(j.scored).toHaveLength(0);
    expect(j.features[0].properties.prediction).toBeNull();
  });

  it('substitutes a default height when roof height is missing or invalid', () => {
    const b = footprints([{ bin: '1000001' }, { bin: '1000002', height_m: -3 }, { bin: '1000003', height_m: 'abc' }, { bin: '1000004', height_m: 22 }]);
    const j = joinByBin(b, contract([]));
    expect(j.features.map((f) => f.properties.height_m)).toEqual([DEFAULT_HEIGHT_M, DEFAULT_HEIGHT_M, DEFAULT_HEIGHT_M, 22]);
    expect(j.features.map((f) => f.properties.height_estimated)).toEqual([true, true, true, false]);
  });

  it('prefers the prediction address over the footprint address', () => {
    const b = footprints([{ bin: '1000001', address: 'Footprint Addr' }]);
    const j = joinByBin(b, contract([{ bin: '1000001', score: 0.5, address: 'Model Addr' }]));
    expect(j.scored[0].properties.address).toBe('Model Addr');
  });
});

describe('parsePredictions', () => {
  it('rejects invalid scores and keeps valid ones', () => {
    const p = contract([
      { bin: '1000001', score: 1.2 },
      { bin: '1000002', score: -0.1 },
      { bin: '1000003', score: 'high' },
      { bin: '1000004', score: Number.NaN },
      { bin: '1000005' },
      { bin: '1000006', score: 0.5 },
    ]);
    expect(p.buildings.map((b) => b.bin)).toEqual(['1000006']);
    expect(p.rejected).toHaveLength(5);
  });

  it('uses the supplied priority, otherwise derives it from the score', () => {
    const p = contract([
      { bin: '1000001', score: 0.2, priority: 'high', rank: 1 },
      { bin: '1000002', score: 0.75, rank: 2 },
    ]);
    expect(p.buildings[0].priority).toBe('high');
    expect(p.buildings[1].priority).toBe('high');
  });

  it('ranks by score when ranks are missing', () => {
    const p = contract([
      { bin: '1000001', score: 0.2 },
      { bin: '1000002', score: 0.9 },
    ]);
    expect(p.buildings.map((b) => [b.bin, b.rank])).toEqual([
      ['1000002', 1],
      ['1000001', 2],
    ]);
  });

  it('handles missing and empty movement history', () => {
    const p = contract([
      { bin: '1000001', score: 0.5, movement_history: [] },
      { bin: '1000002', score: 0.4 },
      { bin: '1000003', score: 0.3, movement_history: [{ date: 'bad', displacement_mm: 1 }, { date: '2026-04-01', displacement_mm: -2 }, { date: '2026-01-01', displacement_mm: -1 }] },
    ]);
    expect(p.buildings[0].movement_history).toEqual([]);
    expect(p.buildings[1].movement_history).toEqual([]);
    expect(p.buildings[2].movement_history.map((m) => m.date)).toEqual(['2026-01-01', '2026-04-01']);
  });

  it('drops duplicate BINs and treats missing optional fields as null', () => {
    const p = contract([
      { bin: '1000001', score: 0.5 },
      { bin: '1000001', score: 0.9 },
    ]);
    expect(p.buildings).toHaveLength(1);
    expect(p.buildings[0].confidence).toBeNull();
    expect(p.buildings[0].explanations).toEqual([]);
    expect(p.rejected[0].reason).toBe('duplicate BIN');
  });

  it('reads data_mode; anything other than "mock" is treated as real', () => {
    expect(contract([]).data_mode).toBe('mock');
    expect(contract([], { data_mode: 'production' }).data_mode).toBe('real');
  });

  it('throws on a malformed file', () => {
    expect(() => parsePredictions({ foo: 1 })).toThrow(/buildings/);
    expect(() => parsePredictions(null)).toThrow();
  });

  it('parses optional decision-support fields and hides invalid ones', () => {
    const p = contract([
      {
        bin: '1000001',
        score: 0.9,
        probability: 0.6,
        score_interval: [0.8, 0.95],
        contributions: [
          { label: 'Small', value: 1, contribution: 0.1 },
          { label: 'Big negative', contribution: -0.7 },
          { label: 'Bad', contribution: 'x' },
        ],
        record_history: [
          { date: '2020-01-01', type: 'FISP filing', description: 'old' },
          { date: '2026-01-01', type: 'DOB violation', description: 'new' },
        ],
        completeness: 0.8,
        missing_inputs: ['Façade material'],
        sources: [{ name: 'DOB', observed_at: '2026-09-30' }],
        movement_history: [{ date: '2026-01-01', displacement_mm: -1, baseline_mm: 0.4 }],
      },
      { bin: '1000002', score: 0.5, probability: 3, score_interval: [0.9, 0.1], completeness: -1 },
    ]);
    const [a, b] = p.buildings;
    expect(a.probability).toBe(0.6);
    expect(a.score_interval).toEqual([0.8, 0.95]);
    expect(a.contributions.map((c) => c.label)).toEqual(['Big negative', 'Small']);
    expect(a.contributions[1].value).toBe('1');
    expect(a.record_history[0].description).toBe('new');
    expect(a.movement_history[0].baseline_mm).toBe(0.4);
    expect(b.probability).toBeNull();
    expect(b.score_interval).toBeNull();
    expect(b.completeness).toBeNull();
    expect(b.contributions).toEqual([]);
  });

  it('fills model card, movement metadata and dates with safe defaults', () => {
    const p = contract([]);
    expect(p.model_card.metrics).toEqual([]);
    expect(p.model.trained_through).toBeNull();
    expect(p.data_as_of).toBeNull();
    expect(p.movement.aggregation_m).toBe(60);
    expect(p.movement.measurement).toMatch(/line-of-sight/i);
  });

  it('accepts the ML service contract (ml/contract/building_score.schema.json)', () => {
    const p = parsePredictions({
      meta: {
        generated_at: '2026-10-17T17:07:03Z',
        as_of: '2026-10-17',
        model: { model_sha256: 'abc123', train_cycles: [7, 8, 9] },
        caveats: ['Not collapse risk.'],
      },
      buildings: [
        {
          bin: '3332220',
          address: '624 CLINTON STREET',
          prediction: { probability: 0.9346, rank: 1, of: 2, tier: 'high', scored_on: { machine: 's390x' } },
          drivers: [
            { feature: 'status_at_cutoff', label: 'Status on record now', value: 'UNSAFE', effect: 'raises', log_odds: 1.07 },
            { feature: 'age', label: 'Building age', value: '96', effect: 'lowers', log_odds: -0.2 },
          ],
          fisp: {
            history: [
              { cycle: 8, status: 'SAFE', filed_on: '2019-01-01' },
              { cycle: 9, status: 'UNSAFE', filed_on: '2024-10-10' },
            ],
          },
          missing: ['lot_area'],
        },
        { bin: '1000001', address: null, prediction: null, drivers: [] },
      ],
    });
    expect(p.data_mode).toBe('real');
    expect(p.model.execution_platform).toBe('IBM LinuxONE');
    expect(p.buildings).toHaveLength(1);
    expect(p.buildings[0]).toMatchObject({ bin: '3332220', score: 0.9346, rank: 1, priority: 'critical' });
    expect(p.buildings[0].explanations).toEqual(['Status on record now: UNSAFE']);
    expect(p.buildings[0].probability).toBe(0.9346);
    expect(p.buildings[0].contributions.map((c) => c.contribution)).toEqual([1.07, -0.2]);
    expect(p.buildings[0].record_history[0].description).toBe('Cycle 9: UNSAFE');
    expect(p.buildings[0].missing_inputs).toEqual(['lot_area']);
    expect(p.model.trained_through).toBe('FISP cycle 9');
    expect(p.data_as_of).toBe('2026-10-17');
    expect(p.model_card.limitations).toEqual(['Not collapse risk.']);
    expect(p.rejected[0].bin).toBe('1000001');
  });
});

describe('legend ranges', () => {
  it('uses half-open bounds so boundary scores belong to one category', () => {
    expect(PRIORITY_RANGE.high).toBe('0.70–<0.85');
    expect(PRIORITY_RANGE.medium).toBe('0.45–<0.70');
    expect(PRIORITY_RANGE.critical).toBe('≥ 0.85');
  });
});

describe('shortlist tools', () => {
  const b = footprints([
    { bin: '1000001', address: '1 Wall Street' },
    { bin: '1000002', address: '20 Broad Street, "Annex"' },
  ]);
  const j = joinByBin(
    b,
    contract([
      { bin: '1000001', score: 0.9, explanations: ['Recent complaint'] },
      { bin: '1000002', score: 0.5 },
    ]),
  );

  it('searches by address substring or BIN prefix', () => {
    expect(searchScored(j.scored, 'wall').map((f) => f.properties.bin)).toEqual(['1000001']);
    expect(searchScored(j.scored, '100000')).toHaveLength(2);
    expect(searchScored(j.scored, '  ')).toEqual([]);
  });

  it('exports CSV in rank order with BIN kept as text and quotes escaped', () => {
    const csv = shortlistCsv(j.scored, (bin) => (bin === '1000001' ? 'assigned' : 'unassigned'));
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('rank,bin,address,priority,score,probability,top_signal,status');
    expect(lines[1]).toBe('1,"=""1000001""",1 Wall Street,Critical,0.900,,Recent complaint,Assigned');
    expect(lines[2]).toContain('"20 Broad Street, ""Annex"""');
  });
});

describe('movement points', () => {
  it('never synthesises background points for real data', () => {
    const b = footprints([{ bin: '1000001' }, { bin: '1000002' }]);
    const real = joinByBin(b, contract([{ bin: '1000001', score: 0.5, factors: { sar_velocity_mm_year: -4 } }], { data_mode: 'real' }));
    expect(movementPoints(real.features, 'real')).toHaveLength(1);
    expect(movementPoints(real.features, 'mock')).toHaveLength(2);
  });
});

describe('demo timeline', () => {
  it('is deterministic and fits in 20–30 seconds', () => {
    const a = demoTimeline().map((s) => [s.at, s.stage]);
    const b = demoTimeline().map((s) => [s.at, s.stage]);
    expect(a).toEqual(b);
    expect(DEMO_DURATION_MS).toBeGreaterThanOrEqual(20_000);
    expect(DEMO_DURATION_MS).toBeLessThanOrEqual(30_000);
    expect(Math.max(...demoTimeline().map((s) => s.at))).toBeLessThan(DEMO_DURATION_MS);
  });
});

describe('committed demo data', () => {
  const read = (f: string) => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8'));
  const buildings = parseBuildings(read('buildings-demo.geojson'));
  const predictions = parsePredictions(read('mock-predictions.json'));

  it('mock predictions are valid, labelled mock, and join to real footprints', () => {
    expect(predictions.data_mode).toBe('mock');
    expect(predictions.rejected).toEqual([]);
    expect(predictions.buildings.length).toBeGreaterThanOrEqual(50);
    const j = joinByBin(buildings, predictions);
    expect(j.unmatchedPredictions).toEqual([]);
    expect(j.scored).toHaveLength(predictions.buildings.length);
  });

  it('covers every priority category and has movement history for the top ranks', () => {
    const cats = new Set(predictions.buildings.map((b) => b.priority));
    expect([...cats].sort()).toEqual(['critical', 'high', 'low', 'medium']);
    for (const b of predictions.buildings.slice(0, 10)) expect(b.movement_history.length).toBeGreaterThan(2);
  });

  it('footprint BINs are unique strings', () => {
    const bins = buildings.features.map((f) => f.properties.bin);
    expect(bins.every((b) => typeof b === 'string' && /^1\d{6}$/.test(b))).toBe(true);
    expect(new Set(bins).size).toBe(bins.length);
  });
});
