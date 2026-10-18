import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleTourInference, tourInferenceKey } from './tourInference';

describe('automatic tour inference', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const state = { active: true, waiting: true, runId: 1, bin: '1078054' };
  it('starts exactly once at the inference step, without a button click', () => {
    const last = { current: null as string | null }, start = vi.fn();
    scheduleTourInference(state, last, start);
    scheduleTourInference(state, last, start); // rerender/callback identity changes
    expect(start).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(start).toHaveBeenCalledTimes(1);
    scheduleTourInference(state, last, start);
    vi.runAllTimers();
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('never starts during normal browsing, before the cue, or after completion', () => {
    const last = { current: null }, start = vi.fn();
    scheduleTourInference({ ...state, active: false }, last, start);
    scheduleTourInference({ ...state, waiting: false }, last, start);
    vi.runAllTimers();
    expect(start).not.toHaveBeenCalled();
  });
  it('allows a fresh request on tour replay or a different building', () => {
    const last = { current: null as string | null }, start = vi.fn();
    for (const step of [state, { ...state, runId: 2 }, { ...state, runId: 2, bin: '1001394' }]) {
      scheduleTourInference(step, last, start);
      vi.runAllTimers();
    }
    expect(start).toHaveBeenCalledTimes(3);
  });
  it('cancels on stop/skip/unmount before the request and tolerates Strict Mode setup-cleanup-setup', () => {
    const last = { current: null as string | null }, start = vi.fn();
    scheduleTourInference(state, last, start)();
    vi.runAllTimers();
    expect(start).not.toHaveBeenCalled();
    expect(last.current).toBeNull();
    scheduleTourInference(state, last, start);
    vi.runAllTimers();
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('does not duplicate a manual request that started in the same tour step', () => {
    const last = { current: null as string | null }, start = vi.fn();
    scheduleTourInference(state, last, start);
    last.current = tourInferenceKey(state.runId, state.bin);
    vi.runAllTimers();
    expect(start).not.toHaveBeenCalled();
  });
});
