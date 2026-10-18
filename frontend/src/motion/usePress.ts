import { useCallback, useRef } from 'react';

/**
 * Activate on pointer-down instead of click.
 *
 * Waiting for the release costs the whole press duration — perceptible on a map, where the camera
 * should already be moving by the time the finger lifts. The click handler stays as the keyboard
 * path (Enter and Space synthesise a click with no pointer sequence) and is suppressed when the
 * pointer already fired.
 */
export function usePress<T extends HTMLElement>(activate: () => void) {
  const firedByPointer = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<T>) => {
      if (e.button !== 0) return;
      firedByPointer.current = true;
      activate();
    },
    [activate],
  );

  const onClick = useCallback(() => {
    if (firedByPointer.current) {
      firedByPointer.current = false;
      return;
    }
    activate();
  }, [activate]);

  // A press that slides off the target never produces a click, so the guard is cleared here too.
  const onPointerLeave = useCallback(() => {
    firedByPointer.current = false;
  }, []);

  return { onPointerDown, onClick, onPointerLeave };
}
