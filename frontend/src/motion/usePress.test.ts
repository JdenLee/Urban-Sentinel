import { describe, expect, it } from 'vitest';
import { pressHandlers } from './usePress';

function setup() {
  let count = 0;
  const h = pressHandlers(() => count++, { current: false });
  return { h, count: () => count };
}

describe('pressHandlers', () => {
  it('mouse activates once, on pointer-down, and swallows the click that follows', () => {
    const { h, count } = setup();
    h.onPointerDown({ button: 0, pointerType: 'mouse' });
    expect(count()).toBe(1);
    h.onClick({ detail: 1 });
    expect(count()).toBe(1);
  });

  it('touch activates once, on the click (pointerleave comes before click on touch)', () => {
    const { h, count } = setup();
    h.onPointerDown({ button: 0, pointerType: 'touch' });
    expect(count()).toBe(0);
    h.onClick({ detail: 1 });
    expect(count()).toBe(1);
  });

  it('a touch that becomes a scroll never activates (the browser sends no click)', () => {
    const { h, count } = setup();
    h.onPointerDown({ button: 0, pointerType: 'touch' });
    expect(count()).toBe(0);
  });

  it('keyboard activates even after a mouse press that slid off without a click', () => {
    const { h, count } = setup();
    h.onPointerDown({ button: 0, pointerType: 'mouse' });
    h.onClick({ detail: 0 });
    expect(count()).toBe(2);
  });

  it('ignores secondary buttons, then still handles a keyboard click', () => {
    const { h, count } = setup();
    h.onPointerDown({ button: 2, pointerType: 'mouse' });
    expect(count()).toBe(0);
    h.onClick({ detail: 0 });
    expect(count()).toBe(1);
  });

  it('a toggle pressed with a pen ends up toggled', () => {
    let on = true;
    const h = pressHandlers(() => (on = !on), { current: false });
    h.onPointerDown({ button: 0, pointerType: 'pen' });
    h.onClick({ detail: 1 });
    expect(on).toBe(false);
  });
});
