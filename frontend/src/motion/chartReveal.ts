interface AnimatedChart {
  getAnimations?: (options: { subtree: boolean }) => Array<{ finished: Promise<unknown> }>;
}

/** Wait for the actual dots AND line masks; cancellation must never advance a stopped tour. */
export function afterChartReveal(chart: AnimatedChart, fallbackMs: number, complete: () => void): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => { if (active) { active = false; complete(); } };
  if (chart.getAnimations) {
    // An empty list (including reduced motion) completes immediately.
    Promise.all(chart.getAnimations({ subtree: true }).map((animation) => animation.finished))
      .then(finish, () => { /* A removed/replaced animation is not a completed reveal. */ });
  } else {
    timer = setTimeout(finish, fallbackMs);
  }
  return () => { active = false; clearTimeout(timer); };
}
