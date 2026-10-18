import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DemoController, demoTimeline, type DemoControllerProps } from '../components/DemoController';
import { LayerControls } from '../components/LayerControls';
import { DEMO_EXPLANATIONS_AT_MS, DEMO_INFERENCE_PAUSE_MS, DEMO_RECORDS_PAUSE_MS, DEMO_HISTORY_PAUSE_MS, PANEL_STOPS } from './demoScript';

const props: DemoControllerProps = { running: true, paused: true, awaitingInference: true, awaitingHistory: false, inferenceBusy: false,
  elapsed: DEMO_INFERENCE_PAUSE_MS, stage: 'Starting live prediction automatically…',
  onStop: vi.fn(), onContinue: vi.fn(), onSkipInference: vi.fn() };
const strip = (overrides: Partial<DemoControllerProps> = {}) => renderToStaticMarkup(createElement(DemoController, { ...props, ...overrides }));

describe('clear tour pause controls', () => {
  it('calls the start button Start tour and does not describe a paused tour as playing', () => {
    const controls = (running: boolean) => renderToStaticMarkup(createElement(LayerControls, {
      showRisk: true, showMovement: false, movementAvailable: true, demoRunning: running,
      onToggleRisk: vi.fn(), onToggleMovement: vi.fn(), onPlayDemo: vi.fn(), onReset: vi.fn(),
    }));
    expect(controls(false)).toContain('Start tour');
    expect(controls(true)).toContain('Tour in progress');
    expect(controls(true)).not.toContain('Playing');
  });
  it('explains automatic inference and always provides a skip action', () => {
    const html = strip();
    expect(html).not.toContain('Tour paused');
    expect(html).toContain('No click needed');
    expect(html).toContain('Skip live step');
    expect(html).not.toContain('Finish tour');
  });
  it('keeps the escape route while a request or result reveal is pending', () => {
    const html = strip({ inferenceBusy: true });
    expect(html).toContain('Running automatically. The tour continues after the result');
    expect(html).toContain('Skip live step');
    expect(html).not.toContain('Click Run on LinuxONE');
  });
  it('preserves the official-records pause with a clear Finish tour action', () => {
    const html = strip({ awaitingInference: false, elapsed: DEMO_RECORDS_PAUSE_MS });
    expect(html).toContain('Finish tour');
    expect(html).toContain('Take your time with the records');
    expect(html).not.toContain('Skip live step');
  });
  it('waits automatically for the chart instead of offering a premature Finish action', () => {
    const html = strip({ awaitingInference: false, awaitingHistory: true, elapsed: DEMO_HISTORY_PAUSE_MS,
      stage: 'Connecting recorded history…' });
    expect(html).toContain('once the dots and lines finish drawing');
    expect(html).toContain('33s / 41s');
    expect(html).not.toContain('Finish tour');
    expect(html).not.toContain('Skip live step');
    expect(html).toContain('Stop');
    expect(PANEL_STOPS.find((step) => step.cue.section === 'history-charts')!.at).toBe(DEMO_HISTORY_PAUSE_MS);
    expect(PANEL_STOPS.find((step) => step.cue.section === 'official')!.at - DEMO_HISTORY_PAUSE_MS).toBe(2500);
  });
  it('has no misleading pause actions while playing or stopped', () => {
    const playing = strip({ paused: false, awaitingInference: false });
    expect(playing).not.toContain('Tour paused');
    expect(playing).not.toContain('Skip live step');
    expect(playing).not.toContain('Finish tour');
    expect(strip({ running: false })).toBe('');
  });
  it('skips directly to explanations, leaving the remaining history and finale intact', () => {
    const remaining = demoTimeline().filter((step) => step.at >= DEMO_EXPLANATIONS_AT_MS);
    expect(remaining[0].stage).toBe('What raised or lowered the score?');
    expect(DEMO_EXPLANATIONS_AT_MS).toBeGreaterThan(DEMO_INFERENCE_PAUSE_MS);
    expect(DEMO_EXPLANATIONS_AT_MS).toBeLessThan(DEMO_RECORDS_PAUSE_MS);
    expect(remaining.at(-1)!.stage).toBe('From evidence to inspection priorities');
  });
});
