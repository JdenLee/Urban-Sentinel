import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProbabilityGauge } from '../components/ProbabilityGauge';

describe('probability speedometer', () => {
  it.each([[0, -90, 0], [0.5, 0, 50], [1, 90, 100], [0.7123, 38.214, 71]])(
    'maps probability %s linearly onto the semicircle', (probability, angle, percent) => {
      const html = renderToStaticMarkup(createElement(ProbabilityGauge, { probability }));
      const actual = Number(/--gauge-angle:([-\d.]+)deg/.exec(html)?.[1]);
      expect(actual).toBeCloseTo(angle, 6);
      expect(html).toContain(`>${percent}%</text>`);
      expect(html).toContain('role="meter"');
      expect(html).toContain(`aria-valuenow="${Number((probability * 100).toFixed(2))}"`);
      expect(html).toContain('aria-valuemin="0"');
      expect(html).toContain('aria-valuemax="100"');
      expect(html).toContain('not collapse');
    },
  );
  it.each([NaN, Infinity, -0.1, 1.1])('does not turn invalid probability %s into a plausible value', (probability) => {
    const html = renderToStaticMarkup(createElement(ProbabilityGauge, { probability }));
    expect(html).toContain('Probability unavailable');
    expect(html).not.toContain('role="meter"');
  });
  it('uses the percentage accent colour for the whole arc, without a rainbow gradient', () => {
    const html = renderToStaticMarkup(createElement(ProbabilityGauge, { probability: 0.71 }));
    expect(html).toContain('class="probability-gauge__arc"');
    expect(html).toContain('stroke="var(--accent, var(--label))"');
    expect(html).not.toContain('linearGradient');
    expect(html).not.toContain('stop-color');
  });
  it('flattens the dial inside a shorter viewport without scaling the text', () => {
    const html = renderToStaticMarkup(createElement(ProbabilityGauge, { probability: 0.71 }));
    expect(html).toContain('viewBox="0 0 320 150"');
    expect(html).toContain('transform="translate(0 4) scale(1 0.65)"');
    expect(html).toContain('vector-effect="non-scaling-stroke"');
    expect(html).toMatch(/<\/g><circle cx="160" cy="87\.2"/);
    expect(html).toContain('y="142" class="probability-gauge__value"');
  });
});
