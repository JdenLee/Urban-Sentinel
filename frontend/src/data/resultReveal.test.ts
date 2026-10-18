import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESULT_REVEAL_MIN_MS, waitForResultReveal } from './resultReveal';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('honest live-result presentation pacing', () => {
  it('holds a fast response briefly without changing service timings or making another request', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const displayed = vi.fn();
    const done = waitForResultReveal(0, new AbortController().signal).then(displayed);
    await vi.advanceTimersByTimeAsync(RESULT_REVEAL_MIN_MS - 101);
    expect(displayed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(displayed).toHaveBeenCalledOnce();
  });
  it('adds no further hold to an already slow response', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    await waitForResultReveal(0, new AbortController().signal);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a pending reveal and removes its timer when stopped or the building changes', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const controller = new AbortController();
    const pending = waitForResultReveal(0, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never schedules a reveal for an already cancelled request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    await expect(waitForResultReveal(0, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
