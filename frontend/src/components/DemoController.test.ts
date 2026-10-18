import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_DURATION_MS, demoPadding, demoTimeline, type DemoActions, type DemoMotion } from './DemoController';

afterEach(() => vi.unstubAllGlobals());

function run(motion?: DemoMotion, target: DemoActions['target'] = { bin: '1000001', center: [-74, 40.72], height_m: 70 }) {
  const moves: { at: number; options: { duration?: number; essential?: boolean; bearing?: number; zoom?: number } }[] = [];
  let at = 0;
  const map = {
    jumpTo: vi.fn(),
    flyTo: vi.fn((options) => moves.push({ at, options })),
    easeTo: vi.fn((options) => moves.push({ at, options })),
    getContainer: () => ({ clientWidth: 1440, clientHeight: 900 }),
  };
  const actions: DemoActions = {
    map: map as unknown as MapLibreMap, target, setShowRisk: vi.fn(), setShowMovement: vi.fn(),
    setSelectedBin: vi.fn(), setPanelOpen: vi.fn(), later: vi.fn(),
  };
  const steps = demoTimeline(motion);
  for (const step of steps) { at = step.at; step.run(actions); }
  return { moves, map, actions, steps };
}

describe('cinematic camera playback', () => {
  it('animates every leg of explicitly requested playback even with the OS reduced-motion preference', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    const { moves, map, steps } = run('cinematic');
    expect(moves).toHaveLength(5);
    expect(map.jumpTo).toHaveBeenCalledOnce();
    expect(map.jumpTo.mock.calls[0][0].zoom).toBeLessThan(13);
    expect(moves.every(({ options }) => options.essential === true && options.duration! >= 5000)).toBe(true);
    // The camera keeps moving through each transition and ends within the advertised tour length.
    for (const [i, move] of moves.entries()) {
      expect(move.at + move.options.duration!).toBeLessThanOrEqual(steps[i + 1]?.at ?? DEMO_DURATION_MS);
    }
    expect(moves[2].options.zoom! - moves[0].options.zoom!).toBeGreaterThan(2);
    expect(moves[3].options.bearing!).toBeGreaterThan(90);
    expect(moves[4].options.zoom!).toBeLessThan(moves[2].options.zoom!);
  });

  it('keeps the same sequence available with instant cuts and respects the preference when no mode is specified', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    for (const result of [run('reduced'), run()]) {
      expect(result.moves).toHaveLength(5);
      expect(result.moves.every(({ options }) => options.duration === 0 && options.essential === false)).toBe(true);
      expect(result.steps.map((s) => s.at)).toEqual([0, 5000, 10000, 17000, 24000]);
      expect(result.actions.setShowRisk).toHaveBeenNthCalledWith(1, false);
      expect(result.actions.setShowRisk).toHaveBeenNthCalledWith(2, true);
    }
  });

  it('can finish without a scored target and keeps tall buildings and responsive panels framed', () => {
    expect(run('cinematic', null).moves).toHaveLength(3);
    const tall = run('cinematic', { bin: '1088469', center: [-74.013, 40.713], height_m: 541 });
    expect(tall.moves[2].options.zoom!).toBeLessThan(16);
    expect(demoPadding(660, 900).bottom).toBeGreaterThan(450);
    expect(demoPadding(1440, 900).right).toBeGreaterThan(400);
  });
});
