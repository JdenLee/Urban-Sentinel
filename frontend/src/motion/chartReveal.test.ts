import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterChartReveal } from './chartReveal';

function pending() {
  let resolve!: () => void;
  let reject!: () => void;
  const finished = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { finished, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

afterEach(() => vi.useRealTimers());
describe('tour waits for the complete chart reveal', () => {
  it('does not advance until both the dots and every connecting line have finished', async () => {
    const dot = pending(), line = pending(), done = vi.fn();
    const getAnimations = vi.fn(() => [dot, line]);
    afterChartReveal({ getAnimations }, 2230, done);
    expect(getAnimations).toHaveBeenCalledWith({ subtree: true });
    dot.resolve();
    await flush();
    expect(done).not.toHaveBeenCalled();
    line.resolve();
    await flush();
    expect(done).toHaveBeenCalledOnce();
  });
  it('cannot resume after stopping, hiding or replacing a chart', async () => {
    const line = pending(), done = vi.fn();
    const cancel = afterChartReveal({ getAnimations: () => [line] }, 2230, done);
    cancel();
    line.resolve();
    await flush();
    expect(done).not.toHaveBeenCalled();
  });
  it('does not count a cancelled CSS animation as completion', async () => {
    const line = pending(), done = vi.fn();
    afterChartReveal({ getAnimations: () => [line] }, 2230, done);
    line.reject();
    await flush();
    expect(done).not.toHaveBeenCalled();
  });
  it('continues immediately when reduced motion produces no animations', async () => {
    const done = vi.fn();
    afterChartReveal({ getAnimations: () => [] }, 2230, done);
    await flush();
    expect(done).toHaveBeenCalledOnce();
  });
  it('uses the chart-derived duration only when animation promises are unsupported', () => {
    vi.useFakeTimers();
    const done = vi.fn();
    afterChartReveal({}, 2230, done);
    vi.advanceTimersByTime(2229);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledOnce();
    const cancel = afterChartReveal({}, 2230, done);
    cancel();
    vi.advanceTimersByTime(3000);
    expect(done).toHaveBeenCalledOnce();
  });
});
