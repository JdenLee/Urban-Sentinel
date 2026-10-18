import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConditionChart, HistoryReplay } from '../components/HistoryReplay';
import { chartPrediction, conditionChartData } from './conditionChart';
import type { FacadeObservation } from './historyReplay';
import type { RecordEvent } from '../types/predictions';

const observations: FacadeObservation[] = [
  { date: '2010-02-19', rating: 'SAFE', ambiguous: false },
  { date: '2012-12-31', rating: 'SWARMP', ambiguous: false },
  { date: '2017-02-21', rating: null, ambiguous: false },
  { date: '2020-01-15', rating: 'UNSAFE', ambiguous: false },
];
const domain: [string, string] = ['2010-02-19', '2022-02-21'];
const prediction = { probability: .8792, generatedAt: '2026-10-18T05:23:00Z', color: '#a34438' };
const chart = (props: Partial<Parameters<typeof ConditionChart>[0]> = {}) =>
  renderToStaticMarkup(createElement(ConditionChart, { observations, domain, prediction, ...props }));

describe('a prediction alongside recorded history, on a separate probability scale', () => {
  it('uses the real probability, full precision marker, and export generation date', () => {
    const html = chart();
    expect(html).toContain('88%');
    expect(html).toContain('87.92% predicted probability');
    expect(html).toContain(`translate(${240 + 106 * .8792} 146)`);
    expect(html).toContain('Loaded model prediction · generated 2026-10-18');
    expect(html).toContain('next Initial FISP filing');
    expect(html).toContain('Not an inspection');
    expect(html).toContain('not collapse');
  });
  it('keeps the prediction off the rating axes and never adds a fourth historical dot/segment', () => {
    const html = chart();
    expect(html.match(/class="condition-chart__dot"/g)).toHaveLength(3);
    expect(html.match(/class="condition-chart__line"/g)).toHaveLength(2);
    expect(html.match(/class="condition-chart__prediction-marker"/g)).toHaveLength(1);
    expect(html).toContain('>0%</text>');
    expect(html).toContain('>100%</text>');
    expect(html).toContain('data-gap="true"');
    // Forecast fades in only after the last historical line's 2230ms reveal.
    expect(html).toContain('animation-delay:2350ms');
  });
  it('retains calendar spacing and cutoff data when reserving room for the prediction', () => {
    const nodes = conditionChartData(observations, domain, [70, 206]);
    expect(nodes[0].x).toBe(70);
    expect(nodes.at(-1)!.x).toBeLessThan(206);
    expect(nodes.slice(0, 2)).toEqual(conditionChartData(observations.slice(0, 2), domain, [70, 206]));
    expect(conditionChartData([observations[0]], [domain[0], domain[0]], [70, 206])[0].x).toBe(138);
  });
  it.each([null, undefined, NaN, Infinity, -.01, 1.01])('does not turn an absent/invalid probability (%s) into a rating or score', (probability) => {
    expect(chartPrediction(probability === undefined ? undefined : { probability })).toBeNull();
    expect(chart({ prediction: probability === undefined ? undefined : { probability } })).not.toContain('condition-chart__prediction-marker');
  });
  it.each([0, 1])('plots the valid endpoint probability %s without overflow', (probability) => {
    const html = chart({ prediction: { probability } });
    expect(html).toContain(`translate(${240 + 106 * probability} 146)`);
    expect(html).toContain(`>${probability * 100}%</text>`);
  });
  it('labels synthetic data and never invents a current date for missing/invalid metadata', () => {
    const html = chart({ prediction: { probability: .5, isMock: true, generatedAt: '2026-02-30' } });
    expect(html).toContain('Synthetic prediction · generation date unavailable');
    expect(html).not.toContain('2026-02-30');
    expect(html).not.toContain('Loaded model prediction');
  });
  it('hides current model values at earlier replay cutoffs and reveals them only at the end', () => {
    const records: RecordEvent[] = observations.map((p) => ({ date: p.date, type: 'FISP filing', description: p.rating ?? '', status: p.rating }));
    const replay = (progress: number) => renderToStaticMarkup(createElement(HistoryReplay, {
      records, points: [], isMock: false, source: null, prediction, demoProgress: progress,
    }));
    expect(replay(0)).toContain('Replay to the end');
    expect(replay(0)).not.toContain('88%');
    expect(replay(0)).not.toContain('2020-01-15: UNSAFE');
    expect(replay(1)).toContain('88%');
    expect(replay(1)).toContain('2020-01-15: UNSAFE');
  });
  it('still shows an available prediction with no historical ratings, without inventing observations', () => {
    const html = chart({ observations: [] });
    expect(html).toContain('No rated filings to plot');
    expect(html).toContain('88%');
    expect(html).not.toContain('condition-chart__dot');
    const noRecords = renderToStaticMarkup(createElement(HistoryReplay, {
      records: [], points: [], isMock: false, source: null, prediction,
    }));
    expect(noRecords).toContain('No dated observations available');
    expect(noRecords).toContain('88%');
  });
});
