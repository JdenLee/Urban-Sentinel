import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseGroundMotion } from './loadGroundMotion';
import { loadPredictionsWithFallback } from './loadPredictions';

const mlRecord = (bin: string, probability: number, rank: number) => ({
  bin,
  address: '1 TEST ST',
  fisp: { history: [{ cycle: 9, status: 'SAFE', filed_on: '2021-01-01' }] },
  prediction: { probability, rank, tier: 'high', scored_on: { machine: 's390x' } },
  drivers: [{ feature: 'status_at_cutoff', label: 'Status on record now', value: 'UNSAFE', effect: 'raises', log_odds: 1.2 }],
  missing: [],
});

describe('parseGroundMotion', () => {
  it('keeps only measured points with finite velocity and uses absolute speed', () => {
    const parsed = parseGroundMotion({
      type: 'FeatureCollection',
      metadata: { units: 'mm/yr' },
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-74.01, 40.71] }, properties: { velocity_mm_yr: -1.5 } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-74.0, 40.72] }, properties: { velocity_mm_yr: null } },
        { type: 'Feature', geometry: null, properties: { velocity_mm_yr: 2 } },
      ],
    });
    expect(parsed?.points).toEqual([{ position: [-74.01, 40.71], speed: 1.5 }]);
    expect(parsed?.metadata).toEqual({ units: 'mm/yr' });
  });

  it('returns null when nothing real is available (no synthetic fallback)', () => {
    expect(parseGroundMotion({ type: 'FeatureCollection', features: [] })).toBeNull();
    expect(parseGroundMotion('nope')).toBeNull();
  });
});

describe('loadPredictionsWithFallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to the LinuxONE snapshot when the live API is down', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('live')) throw new TypeError('connection refused');
      return new Response(JSON.stringify({ meta: { as_of: '2026-10-17' }, buildings: [mlRecord('1000001', 0.8, 1)] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await loadPredictionsWithFallback(undefined, [
      { id: 'live-api', label: 'Live', url: 'http://live/predictions' },
      { id: 'linuxone-snapshot', label: 'Snapshot', url: '/data/linuxone-predictions.json' },
    ]);
    expect(out.source.id).toBe('linuxone-snapshot');
    expect(out.set.data_mode).toBe('real');
    expect(out.set.buildings[0].bin).toBe('1000001');
    expect(out.failures[0]).toContain('Live');
  });
});
