import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusBuilding } from './buildingFocus';

afterEach(() => vi.unstubAllGlobals());

function scene(reduced = false, width = 1440, height = 900) {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) });
  const listeners = new Set<() => void>();
  const moveend = () => [...listeners].forEach((fn) => fn());
  const map = {
    getContainer: () => ({ clientWidth: width, clientHeight: height }),
    getBearing: () => 170,
    flyTo: vi.fn(), easeTo: vi.fn(),
    // MapLibre emits moveend when a running animation is interrupted.
    stop: vi.fn(moveend),
    on: vi.fn((_event: string, fn: () => void) => listeners.add(fn)),
    off: vi.fn((_event: string, fn: () => void) => listeners.delete(fn)),
  };
  return { map, api: map as unknown as MapLibreMap, moveend, listeners };
}

describe('selected building camera', () => {
  it('arrives before orbiting, keeps the building centered, and finishes without holding camera control', () => {
    const { map, api, moveend, listeners } = scene();
    const center: [number, number] = [-74, 40.72];
    const stop = focusBuilding(api, center, 60);
    expect(map.flyTo.mock.calls[0][0]).toMatchObject({ center, duration: 2200 });
    expect(map.easeTo).not.toHaveBeenCalled();
    moveend();
    expect(map.easeTo.mock.calls[0][0]).toMatchObject({ center, bearing: 260, duration: 12_000 });
    moveend();
    expect(listeners.size).toBe(0);
    const stopCount = map.stop.mock.calls.length;
    stop();
    expect(map.stop).toHaveBeenCalledTimes(stopCount);
  });

  it('does not restart an orbit when the user interrupts the approach or selects another building', () => {
    const { map, api, moveend, listeners } = scene();
    const cancel = focusBuilding(api, [-74, 40.72]);
    cancel();
    moveend();
    expect(listeners.size).toBe(0);
    expect(map.easeTo).not.toHaveBeenCalled();
    focusBuilding(api, [-74.01, 40.71]);
    moveend();
    expect(map.easeTo).toHaveBeenCalledOnce();
    expect(map.easeTo.mock.calls[0][0].center).toEqual([-74.01, 40.71]);
  });

  it('lets the user stop an orbit without leaving an arrival listener behind', () => {
    const { map, api, moveend, listeners } = scene();
    const cancel = focusBuilding(api, [-74, 40.72]);
    moveend();
    cancel();
    moveend();
    expect(listeners.size).toBe(0);
    expect(map.easeTo).toHaveBeenCalledOnce();
  });

  it('frames the selection instantly without an orbit when Reduce Motion is enabled', () => {
    const { map, api, moveend, listeners } = scene(true);
    focusBuilding(api, [-74, 40.72]);
    moveend();
    expect(map.flyTo.mock.calls[0][0]).toMatchObject({ duration: 0, essential: false });
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('backs away for tall landmarks and leaves room for the mobile details sheet', () => {
    const desktop = scene();
    focusBuilding(desktop.api, [-74, 40.72], 60);
    const phone = scene(false, 390, 844);
    focusBuilding(phone.api, [-74.013, 40.713], 541);
    const framing = phone.map.flyTo.mock.calls[0][0];
    expect(framing.zoom).toBeLessThan(desktop.map.flyTo.mock.calls[0][0].zoom - 1);
    expect(framing.padding.bottom).toBeGreaterThan(844 / 2);
    expect(framing.padding.top + framing.padding.bottom).toBeLessThan(844);
  });
});
