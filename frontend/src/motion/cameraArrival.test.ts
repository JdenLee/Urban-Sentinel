import { describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterCameraArrival } from './cameraArrival';

function camera() {
  const handlers = new Set<() => void>();
  const map = {
    on: vi.fn((_event: string, fn: () => void) => { handlers.add(fn); }),
    off: vi.fn((_event: string, fn: () => void) => { handlers.delete(fn); }),
  } as unknown as MapLibreMap;
  return { map, finish: () => [...handlers].forEach((fn) => fn()), handlers };
}

describe('camera-arrival selection', () => {
  it('waits for moveend, fires once and removes the listener before subsequent orbit events', () => {
    const { map, finish, handlers } = camera();
    const select = vi.fn();
    afterCameraArrival(map, select);
    expect(select).not.toHaveBeenCalled();
    finish();
    expect(select).toHaveBeenCalledOnce();
    expect(handlers.size).toBe(0);
    finish();
    expect(select).toHaveBeenCalledOnce();
  });
  it('cancels pending selection before stop/replay/unmount can emit moveend', () => {
    const { map, finish, handlers } = camera();
    const select = vi.fn();
    const cancel = afterCameraArrival(map, select);
    cancel();
    finish();
    expect(select).not.toHaveBeenCalled();
    expect(handlers.size).toBe(0);
  });
  it('handles immediate arrival for a reduced-motion camera', () => {
    const { map, finish } = camera();
    const select = vi.fn();
    afterCameraArrival(map, select);
    finish();
    expect(select).toHaveBeenCalledOnce();
  });
});
