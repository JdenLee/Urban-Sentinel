import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConditionChart, ConditionStory } from '../components/HistoryReplay';
import { facadeChange } from './historyReplay';
import { conditionChartData, conditionRevealDuration, CONDITION_DOT_MS, CONDITION_LINE_MS } from './conditionChart';
import type { FacadeObservation } from './historyReplay';

const observations: FacadeObservation[] = [
  { date: '2010-02-19', rating: 'SAFE', ambiguous: false },
  { date: '2012-12-31', rating: 'SWARMP', ambiguous: false },
  { date: '2017-02-21', rating: null, ambiguous: false },
  { date: '2020-01-15', rating: 'UNSAFE', ambiguous: false },
  { date: '2022-02-21', rating: null, ambiguous: false },
];
const domain: [string, string] = [observations[0].date, observations.at(-1)!.date];
describe('progressive rated-façade chart', () => {
  it('joins the last known ratings and explicitly flags bridges across unrated filings', () => {
    const nodes = conditionChartData(observations, domain);
    expect(nodes.map((p) => p.rating)).toEqual(['SAFE', 'SWARMP', 'UNSAFE']);
    expect(nodes[0].from).toBeNull();
    expect(nodes[1].from).toEqual({ x: nodes[0].x, y: nodes[0].y });
    expect(nodes[1].bridgesGap).toBe(false);
    expect(nodes[2].from).toEqual({ x: nodes[1].x, y: nodes[1].y });
    expect(nodes[2].bridgesGap).toBe(true);
  });
  it('keeps positions and prior animation delays stable as the cutoff advances', () => {
    const early = conditionChartData(observations.slice(0, 2), domain);
    const later = conditionChartData(observations, domain);
    expect(later.slice(0, 2)).toEqual(early);
    expect(early.map((p) => p.date)).not.toContain('2020-01-15');
    expect(later[2].x).toBeLessThan(306); // still respects the unrated 2022 endpoint
  });
  it('staggers visible dots and leaves enough time for their connecting-line reveal', () => {
    const nodes = conditionChartData(observations, domain);
    expect(nodes.map((p) => p.delay)).toEqual([0, 600, 1200]);
    expect(nodes[2].delay + CONDITION_DOT_MS + CONDITION_LINE_MS).toBeLessThan(2500);
    expect(conditionRevealDuration(nodes)).toBe(2230);
    expect(conditionRevealDuration(nodes.slice(0, 1))).toBe(CONDITION_DOT_MS);
    expect(conditionRevealDuration([])).toBe(0);
  });
  it('renders rated dots, a draw-on line and a gap caption with no question-mark glyphs', () => {
    const html = renderToStaticMarkup(createElement(ConditionChart, { observations, domain }));
    expect(html).not.toContain('?');
    expect(html.match(/class="condition-chart__dot"/g)).toHaveLength(3);
    expect(html.match(/class="condition-chart__line"/g)).toHaveLength(2);
    expect(html.match(/class="condition-chart__reveal"/g)).toHaveLength(2);
    expect(html.match(/data-gap="true"/g)).toHaveLength(1);
    expect(html).toContain('stroke-dasharray="5 4"');
    expect(html).toContain('Dashed lines bridge unrated or conflicting filings');
    expect(html).toContain('2 filings have');
    expect(html).toContain('animation-delay:980ms'); // the second dot's 600ms + 380ms reveal
    expect(html).toContain('--condition-animation-state:paused'); // reveal waits for viewport entry
    expect(html).toContain('unknown or conflicting'); // accessible data still acknowledges gaps
  });
  it('centers a single dated rating without inventing a segment', () => {
    const nodes = conditionChartData([observations[0]], [domain[0], domain[0]]);
    expect(nodes[0].x).toBe(197);
    expect(nodes[0].from).toBeNull();
    expect(conditionChartData([], domain)).toEqual([]);
  });
  it('bridges multiple missing/conflicting filings without inventing or extrapolating points', () => {
    const nodes = conditionChartData([observations[0],
      { date: '2011-01-01', rating: null, ambiguous: true }, observations[2], observations[3], observations[4]], domain);
    expect(nodes).toHaveLength(2);
    expect(nodes[1].bridgesGap).toBe(true);
    expect(nodes[1].from).toEqual({ x: nodes[0].x, y: nodes[0].y });
    expect(nodes[1].date).toBe('2020-01-15');
    expect(conditionChartData([observations[2], observations[4]], domain)).toEqual([]);
  });
});

describe('recorded condition colour, independent of trend', () => {
  it.each(['SAFE', 'SWARMP', 'UNSAFE'] as const)('colours a single %s filing even without a comparable trend', (rating) => {
    const change = facadeChange([{ date: '2020-01-01', rating, ambiguous: false }]);
    expect(change.direction).toBe('unknown');
    const html = renderToStaticMarkup(createElement(ConditionStory, { change }));
    expect(html).toContain(`condition-story--${rating.toLowerCase()}`);
    expect(html).toContain(`>${rating}</span>`);
  });
  it('uses amber for an improved-but-still-SWARMP filing', () => {
    const change = facadeChange([{ date: '2018-01-01', rating: 'UNSAFE', ambiguous: false },
      { date: '2020-01-01', rating: 'SWARMP', ambiguous: false }]);
    expect(change.direction).toBe('better');
    expect(change.rating).toBe('SWARMP');
  });
  it('retains the last rated colour with the missing-record caveat, never guesses conflicts', () => {
    const missing = facadeChange(observations);
    expect(missing.rating).toBe('UNSAFE');
    expect(missing.detail).toContain('subsequent condition change is unknown');
    const conflict = facadeChange([...observations, { date: '2025-01-01', rating: null, ambiguous: true }]);
    const html = renderToStaticMarkup(createElement(ConditionStory, { change: conflict }));
    expect(html).toContain('condition-story--unknown');
    expect(html).toContain('Uncertain');
    expect(facadeChange([]).rating).toBeNull();
  });
});
