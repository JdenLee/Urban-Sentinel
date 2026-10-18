/*
 * One spring model, sampled two ways.
 *
 * Declarative transitions bake the spring into a CSS `linear()` easing; gestures integrate the same
 * equation per frame so a release can carry the pointer's velocity. Sharing the constants is what
 * makes a flicked sheet and a settling panel feel like the same material.
 */

export interface SpringConfig {
  /** Pull toward the target. Higher is faster and tighter. */
  stiffness: number;
  /** Resistance. At 2·√(stiffness·mass) the spring is critically damped and never overshoots. */
  damping: number;
  mass: number;
}

export const SPRINGS = {
  /** Press and release. Very stiff: a press that outlasts the finger reads as lag, not weight. */
  press: { stiffness: 2000, damping: 80, mass: 1 },
  /** Small chrome arriving. Slightly underdamped, so it lands with a little weight. */
  pop: { stiffness: 400, damping: 26, mass: 1 },
  /** Large surfaces sliding in. Near critical: a big panel that wobbles reads as cheap. */
  panel: { stiffness: 260, damping: 30, mass: 1 },
  /** A dragged sheet settling, carrying whatever velocity the pointer left it with. */
  sheet: { stiffness: 300, damping: 32, mass: 1 },
} satisfies Record<string, SpringConfig>;

export type SpringName = keyof typeof SPRINGS;

/** Fixed sub-step. Small enough to stay stable at the stiffest preset above. */
const DT = 1 / 600;
const MAX_SECONDS = 4;

function accelerate(c: SpringConfig, x: number, v: number, target: number) {
  return (-c.stiffness * (x - target) - c.damping * v) / c.mass;
}

/**
 * Integrate from 0 to 1 and return normalised displacement sampled at a fixed interval, plus the
 * time the spring takes to settle. Semi-implicit Euler: cheap, and stable for springs.
 */
function trace(config: SpringConfig) {
  const samples: number[] = [0];
  let x = 0;
  let v = 0;
  let t = 0;
  while (t < MAX_SECONDS) {
    v += accelerate(config, x, v, 1) * DT;
    x += v * DT;
    t += DT;
    samples.push(x);
    // Stop once the remainder is sub-pixel for any travel this UI uses. A tighter bound only buys
    // invisible tail, and the tail is real duration: a transition that long feels like lag.
    if (Math.abs(1 - x) < 0.004 && Math.abs(v) < 0.06) break;
  }
  return { samples, seconds: t };
}

/**
 * Bake a spring into a CSS `linear()` easing. Browsers cannot run a spring natively, but they can
 * follow a dense piecewise-linear approximation of one, which keeps the motion on the compositor.
 */
export function springEasing(config: SpringConfig, steps = 40) {
  const { samples, seconds } = trace(config);
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const at = Math.round((i / steps) * (samples.length - 1));
    points.push(samples[at].toFixed(4).replace(/\.?0+$/, '') || '0');
  }
  return { durationMs: Math.round(seconds * 1000), easing: `linear(${points.join(', ')})` };
}

/**
 * Publish every preset as `--ease-<name>` / `--dur-<name>`. The stylesheet carries static fallbacks,
 * so the interface is still styled correctly before this runs.
 */
export function installSpringTokens(el: HTMLElement = document.documentElement) {
  const still = reducedMotion();
  for (const [name, config] of Object.entries(SPRINGS)) {
    const { durationMs, easing } = springEasing(config);
    el.style.setProperty(`--ease-${name}`, easing);
    el.style.setProperty(`--dur-${name}`, still ? '0ms' : `${durationMs}ms`);
  }
}

export function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * A spring you can interrupt. The target can move, and a release can inject velocity, so an
 * animation in flight is never restarted from zero — it is deflected from wherever it currently is.
 */
export class SpringValue {
  value: number;
  velocity = 0;
  private target: number;
  private frame = 0;
  private last = 0;

  constructor(
    private config: SpringConfig,
    initial: number,
    private onChange: (value: number) => void,
  ) {
    this.value = initial;
    this.target = initial;
  }

  /** Aim at a new resting place. Any motion already underway is carried into it. */
  springTo(target: number, velocity?: number) {
    this.target = target;
    if (velocity !== undefined) this.velocity = velocity;
    if (reducedMotion()) {
      this.settle();
      return;
    }
    this.start();
  }

  /** Take manual control, e.g. a pointer grabbing a surface mid-flight. */
  grab() {
    this.pause();
    this.velocity = 0;
  }

  /** Move the value directly while a gesture is driving it. */
  set(value: number) {
    this.value = value;
    this.onChange(value);
  }

  private settle() {
    this.pause();
    this.value = this.target;
    this.velocity = 0;
    this.onChange(this.value);
  }

  private start() {
    if (this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private pause() {
    if (!this.frame) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private tick = (now: number) => {
    // A long frame is clamped rather than integrated whole: a tab returning from the background
    // should not launch the surface across the screen.
    const elapsed = Math.min((now - this.last) / 1000, 0.064);
    this.last = now;
    for (let t = 0; t < elapsed; t += DT) {
      this.velocity += accelerate(this.config, this.value, this.velocity, this.target) * DT;
      this.value += this.velocity * DT;
    }
    this.onChange(this.value);
    if (Math.abs(this.target - this.value) < 0.05 && Math.abs(this.velocity) < 0.5) {
      this.frame = 0;
      this.settle();
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  dispose() {
    this.pause();
  }
}
