import { useMemo, useRef } from 'react';

type PressPointerEvent = { button: number; pointerType: string };
type PressClickEvent = { detail: number };

/**
 * The press logic without React, so it can be tested directly.
 *
 * Mouse and pen activate on pointer-down. Touch keeps the click: on a touch screen the same
 * pointer-down also begins a scroll, and the browser cancels the click when the finger moves, which
 * is the only way to tell a tap from a swipe across a list. Touch also fires pointerleave before
 * click, so a guard cleared on leave cannot suppress the click that follows a touch press.
 *
 * The click suppressed after a pointer activation is identified by `detail`: pointer-generated
 * clicks count presses (detail >= 1), while Enter, Space and assistive technology synthesise clicks
 * with detail 0, so the keyboard path always activates even after a press that slid off its target.
 */
export function pressHandlers(activate: () => void, firedByPointer: { current: boolean }) {
  return {
    onPointerDown(e: PressPointerEvent) {
      firedByPointer.current = e.button === 0 && e.pointerType !== 'touch';
      if (firedByPointer.current) activate();
    },
    onClick(e: PressClickEvent) {
      const alreadyFired = firedByPointer.current && e.detail !== 0;
      firedByPointer.current = false;
      if (!alreadyFired) activate();
    },
  };
}

/**
 * Activate on pointer-down instead of click, for mouse and pen.
 *
 * Waiting for the release costs the whole press duration — perceptible on a map, where the camera
 * should already be moving by the time the button comes up. See `pressHandlers` for touch and keyboard.
 */
export function usePress<T extends HTMLElement>(activate: () => void) {
  const firedByPointer = useRef(false);
  const activateRef = useRef(activate);
  activateRef.current = activate;
  return useMemo(() => {
    const h = pressHandlers(() => activateRef.current(), firedByPointer);
    return {
      onPointerDown: (e: React.PointerEvent<T>) => h.onPointerDown(e),
      onClick: (e: React.MouseEvent<T>) => h.onClick(e),
    };
  }, []);
}
