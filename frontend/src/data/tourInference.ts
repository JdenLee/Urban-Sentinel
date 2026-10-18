export const tourInferenceKey = (runId: number, bin: string) => `${runId}:${bin}`;

/** Defer until effects settle, so Strict Mode cleanup cannot cancel an already-claimed request. */
export function scheduleTourInference(
  state: { active: boolean; waiting: boolean; runId: number; bin: string },
  lastAttempt: { current: string | null },
  start: () => void,
): () => void {
  if (!state.active || !state.waiting) return () => {};
  const key = tourInferenceKey(state.runId, state.bin);
  const timer = setTimeout(() => {
    if (lastAttempt.current === key) return;
    lastAttempt.current = key;
    start();
  }, 0);
  return () => clearTimeout(timer);
}
