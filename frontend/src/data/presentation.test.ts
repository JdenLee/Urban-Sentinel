import { describe, expect, it, vi } from 'vitest';
import { chooseDemoBuilding, historyIndex, PANEL_STOPS, DEMO_DURATION_MS, DEMO_RECORDS_PAUSE_MS, DEMO_INFERENCE_PAUSE_MS, DEMO_FOCUS_AT_MS, DEMO_FOCUS_DURATION_MS, DEMO_FINALE_AT_MS } from './demoScript';
import { cityScale, pinOffset, CITY_RISE_MS, CITY_SWEEP_MS, CITY_COLOR_AT_MS, CITY_COLOR_FADE_MS, PIN_DROP_MS, PIN_SETTLE_MS, PIN_HOVER_MS } from '../motion/sceneMotion';
import { buildingUse } from './buildingFacts';
import { orbitStep } from '../motion/BuildingOrbit';
import { demoTimeline, type DemoActions } from '../components/DemoController';
import type { JoinedFeature } from '../types/predictions';

function building(address: string, rank: number): JoinedFeature {
  return { properties: { address, prediction: { rank } } } as JoinedFeature;
}

describe('presentation target and cues', () => {
  it('selects the requested 707 only when present, otherwise the actual top rank without renaming it', () => {
    const top = building('709 F D R DRIVE', 1), preferred = building('707 F D R DRIVE', 22);
    expect(chooseDemoBuilding([top, preferred])).toBe(preferred);
    const unordered = [building('707 BROADWAY', 99), top];
    expect(chooseDemoBuilding(unordered)).toBe(top);
    expect(unordered[0].properties.address).toBe('707 BROADWAY');
    expect(chooseDemoBuilding([])).toBeNull();
  });
  it('covers photos, total-unit facts, one live request, explanations, history charts and official records', () => {
    expect(PANEL_STOPS.map((s) => s.cue.section)).toEqual(['score', 'photos', 'photos', 'facts', 'inference', 'contributions', 'history', 'history', 'history-charts', 'official']);
    expect(PANEL_STOPS.filter((s) => s.cue.image).map((s) => s.cue.image)).toEqual(['aerial', 'street']);
    const inferenceStops = PANEL_STOPS.filter((s) => s.cue.awaitInference);
    expect(inferenceStops).toHaveLength(1);
    expect(inferenceStops[0].at).toBe(DEMO_INFERENCE_PAUSE_MS);
    expect(DEMO_INFERENCE_PAUSE_MS).toBeLessThan(DEMO_RECORDS_PAUSE_MS);
    expect(DEMO_DURATION_MS).toBe(41_000);
    const at = demoTimeline().map((s) => s.at);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(Math.max(...at)).toBeLessThan(DEMO_DURATION_MS);
    expect(DEMO_RECORDS_PAUSE_MS).toBeGreaterThan(PANEL_STOPS.at(-1)!.at);
    expect(DEMO_RECORDS_PAUSE_MS).toBeLessThan(at.at(-1)!);
  });
  it('grows gray first, colours during approach, and selects only after the close-up arrives', () => {
    const map = { jumpTo: vi.fn(), flyTo: vi.fn(), easeTo: vi.fn(), stop: vi.fn(), getContainer: () => ({ clientWidth: 1280, clientHeight: 720 }) };
    let arrival = () => {};
    const actions = { map, target: { bin: '1078054', center: [-74, 40.7], height_m: 50 }, deskOpen: () => false,
      setShowRisk: vi.fn(), setShowMovement: vi.fn(), setSelectedBin: vi.fn(), setPanelOpen: vi.fn(), present: vi.fn(), later: vi.fn(), setOpeningPhase: vi.fn(),
      afterArrival: (fn: () => void) => { arrival = fn; } } as unknown as DemoActions;
    const steps = demoTimeline();
    steps[0].run(actions);
    expect(actions.setOpeningPhase).toHaveBeenLastCalledWith('rise');
    expect(actions.setShowRisk).toHaveBeenLastCalledWith(false);
    expect(map.jumpTo).toHaveBeenCalledOnce();
    expect(map.flyTo).not.toHaveBeenCalled();
    steps[1].run(actions);
    expect(steps[1].at).toBe(CITY_RISE_MS);
    expect(actions.setOpeningPhase).toHaveBeenLastCalledWith('approach');
    expect(actions.setShowRisk).toHaveBeenLastCalledWith(false);
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ duration: CITY_SWEEP_MS }));
    steps[2].run(actions);
    expect(steps[2].at).toBe(CITY_COLOR_AT_MS);
    expect(steps[2].at).toBeGreaterThan(steps[1].at);
    expect(steps[2].at + CITY_COLOR_FADE_MS).toBeLessThan(steps[1].at + CITY_SWEEP_MS);
    expect(actions.setOpeningPhase).toHaveBeenLastCalledWith('reveal');
    expect(map.flyTo).toHaveBeenCalledTimes(1);
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(actions.setShowRisk).toHaveBeenLastCalledWith(true);
    expect(steps[3].at).toBe(DEMO_FOCUS_AT_MS);
    expect(steps[3].at).toBeGreaterThanOrEqual(CITY_COLOR_AT_MS + CITY_COLOR_FADE_MS);
    expect(steps[3].at - (CITY_RISE_MS + CITY_SWEEP_MS)).toBeLessThanOrEqual(100);
    steps[3].run(actions);
    expect(actions.setOpeningPhase).toHaveBeenLastCalledWith('complete');
    expect(actions.setSelectedBin).toHaveBeenLastCalledWith(null);
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 16.25, duration: DEMO_FOCUS_DURATION_MS }));
    arrival();
    expect(actions.setSelectedBin).toHaveBeenLastCalledWith('1078054');
    expect(PANEL_STOPS[0].at).toBeGreaterThanOrEqual(DEMO_FOCUS_AT_MS + DEMO_FOCUS_DURATION_MS);
    steps.filter((s) => s.at >= PANEL_STOPS[0].at && s.at < DEMO_FINALE_AT_MS).forEach((s) => s.run(actions));
    expect(actions.present).toHaveBeenCalledTimes(PANEL_STOPS.length);
    expect(map.flyTo).toHaveBeenCalledTimes(2); // panel cues never interrupt the building orbit
    steps[0].run(actions); // replay immediately resets colours and selection again
    expect(actions.setShowRisk).toHaveBeenLastCalledWith(false);
    expect(actions.setSelectedBin).toHaveBeenLastCalledWith(null);
    expect(actions.setOpeningPhase).toHaveBeenLastCalledWith('rise');
  });
  it('clamps demo history steps to actual observation indices', () => {
    expect(historyIndex(0, 7)).toBe(0);
    expect(historyIndex(.5, 7)).toBe(3);
    expect(historyIndex(1, 7)).toBe(6);
    expect(historyIndex(10, 7)).toBe(6);
    expect(historyIndex(NaN, 0)).toBe(0);
  });
});

describe('building use and motion', () => {
  it('grows the city and drops a pin without overshoot or negative heights', () => {
    expect(cityScale(0)).toBe(.001);
    expect(cityScale(CITY_RISE_MS / 2)).toBe(.5);
    expect(cityScale(CITY_RISE_MS + 1000)).toBe(1);
    expect(pinOffset(0)).toBe(160);
    expect(pinOffset(PIN_DROP_MS / 2)).toBe(80);
    expect(pinOffset(PIN_DROP_MS)).toBe(0);
    expect(pinOffset(-100)).toBe(160);
  });
  it('lands with a small bounce and hovers continuously without dipping below the roof marker', () => {
    expect(pinOffset(PIN_DROP_MS + PIN_SETTLE_MS / 2)).toBeCloseTo(6);
    const hoverStart = PIN_DROP_MS + PIN_SETTLE_MS;
    expect(pinOffset(hoverStart)).toBeCloseTo(0);
    expect(pinOffset(hoverStart + PIN_HOVER_MS / 2)).toBeCloseTo(5);
    expect(pinOffset(hoverStart + PIN_HOVER_MS)).toBeCloseTo(0);
    for (let ms = PIN_DROP_MS; ms < 30_000; ms += 17) {
      expect(pinOffset(ms)).toBeGreaterThanOrEqual(0);
      expect(pinOffset(ms)).toBeLessThanOrEqual(6);
    }
    for (const join of [PIN_DROP_MS, hoverStart, hoverStart + PIN_HOVER_MS]) {
      expect(Math.abs(pinOffset(join - .01) - pinOffset(join + .01))).toBeLessThan(.001);
    }
  });
  it.each([
    ['U9', 'Transportation & utility', 'Utility'], ['T1', 'Transportation & utility', 'Transportation'],
    ['R1', 'Commercial & office', 'Commercial'], ['R1', 'Multi-family elevator', 'Residential'],
    ['S2', 'Mixed residential & commercial', 'Mixed use'], ['W1', null, 'Civic'], ['F1', null, 'Industrial'],
    ['R9', null, 'Other'], [null, null, 'Other'],
  ])('labels %s / %s as %s without guessing condo use', (buildingClass, landUse, expected) => {
    expect(buildingUse({ buildingClass, landUse })).toBe(expected);
  });
  it('rotates slowly at the same rate at 30 and 60 fps and ignores background time', () => {
    let slow = 0, fast = 0;
    for (let i = 0; i < 30; i++) slow = orbitStep(slow, 1000 / 30);
    for (let i = 0; i < 60; i++) fast = orbitStep(fast, 1000 / 60);
    expect(slow).toBeCloseTo(2.5);
    expect(fast).toBeCloseTo(slow);
    expect(orbitStep(20, 60_000)).toBeCloseTo(20.25);
    expect(orbitStep(20, -5)).toBe(20);
  });
});
