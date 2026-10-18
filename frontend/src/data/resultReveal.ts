/** Presentation pacing only: never added to the timings reported by the inference service. */
export const RESULT_REVEAL_MIN_MS = 1800;

export function waitForResultReveal(startedAt: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  const remaining = Math.max(0, RESULT_REVEAL_MIN_MS - (performance.now() - startedAt));
  if (!remaining) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, remaining);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
