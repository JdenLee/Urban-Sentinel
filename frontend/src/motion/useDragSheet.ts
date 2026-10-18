import { useCallback, useEffect, useRef } from 'react';
import { SPRINGS, SpringValue } from './spring';

/** Past this fraction of its own height, or this flick speed, the sheet goes rather than returns. */
const DISMISS_FRACTION = 0.3;
const DISMISS_VELOCITY = 650;
/** Apple's rubber band: resistance grows with distance, so the sheet never quite leaves the finger. */
const RESISTANCE = 0.55;

function rubberBand(distance: number, dimension: number) {
  return (distance * RESISTANCE * dimension) / (distance + RESISTANCE * dimension);
}

/**
 * Drag-to-dismiss for a bottom sheet.
 *
 * The sheet tracks the pointer one-to-one while held, and on release hands its velocity to a spring,
 * so a flick and a slow drag end differently. Grabbing it again mid-flight stops the spring where it
 * is rather than restarting it, which is what makes the surface feel like an object rather than a
 * transition.
 */
export function useDragSheet(enabled: boolean, onDismiss: () => void) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const springRef = useRef<SpringValue | null>(null);
  const dismissing = useRef(false);
  const drag = useRef<{ startY: number; base: number; samples: { t: number; y: number }[] } | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const spring = new SpringValue(SPRINGS.sheet, 0, (y) => {
      const el = sheetRef.current;
      if (!el) return;
      el.style.transform = y > 0.5 ? `translate3d(0, ${y.toFixed(2)}px, 0)` : '';
      if (dismissing.current && y >= el.offsetHeight - 2) {
        dismissing.current = false;
        dismissRef.current();
      }
    });
    springRef.current = spring;
    return () => {
      spring.dispose();
      springRef.current = null;
    };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const spring = springRef.current;
    if (!spring || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    spring.grab();
    dismissing.current = false;
    drag.current = { startY: e.clientY, base: spring.value, samples: [{ t: performance.now(), y: spring.value }] };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const spring = springRef.current;
    const state = drag.current;
    const el = sheetRef.current;
    if (!spring || !state || !el) return;
    const delta = state.base + (e.clientY - state.startY);
    const y = delta >= 0 ? delta : -rubberBand(-delta, el.offsetHeight);
    spring.set(y);
    const now = performance.now();
    state.samples.push({ t: now, y });
    while (state.samples.length > 2 && now - state.samples[0].t > 90) state.samples.shift();
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const spring = springRef.current;
    const state = drag.current;
    const el = sheetRef.current;
    drag.current = null;
    if (!spring || !state || !el) return;
    e.currentTarget.releasePointerCapture(e.pointerId);

    const first = state.samples[0];
    const span = (performance.now() - first.t) / 1000;
    const velocity = span > 0.004 ? (spring.value - first.y) / span : 0;

    const height = el.offsetHeight;
    const flung = velocity > DISMISS_VELOCITY;
    const dragged = spring.value > height * DISMISS_FRACTION && velocity > -DISMISS_VELOCITY;
    if (flung || dragged) {
      dismissing.current = true;
      spring.springTo(height, velocity);
    } else {
      spring.springTo(0, velocity);
    }
  }, []);

  // Leaving the sheet layout (a window widened back to the desk layout) drops any offset.
  useEffect(() => {
    if (enabled) return;
    drag.current = null;
    dismissing.current = false;
    springRef.current?.grab();
    springRef.current?.set(0);
  }, [enabled]);

  const grabberProps = enabled
    ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }
    : {};

  return { sheetRef, grabberProps };
}
