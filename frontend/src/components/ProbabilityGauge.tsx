import type { CSSProperties } from 'react';

/** A probability dial, not a category scale: exported priority tiers may be rank-based. */
export function ProbabilityGauge({ probability }: { probability: number }) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    return <p className="muted small">Probability unavailable</p>;
  }
  const percent = Math.round(probability * 100);
  return <div className="probability-gauge" role="meter" aria-label="Predicted UNSAFE filing probability"
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number((probability * 100).toFixed(2))}
    aria-valuetext={`${percent}% estimated chance of an UNSAFE Initial FISP filing, not collapse`}>
    <svg viewBox="0 0 320 150" aria-hidden="true" focusable="false">
      {/* Flatten only the dial geometry: labels and percentage keep their natural proportions. */}
      <g className="probability-gauge__dial" transform="translate(0 4) scale(1 0.65)">
      <path className="probability-gauge__arc" d="M 44 128 A 116 116 0 0 1 276 128" fill="none"
        stroke="var(--accent, var(--label))" strokeWidth="12" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {[0, 0.25, 0.5, 0.75, 1].map((value) => <line key={value} x1="160" y1="29" x2="160" y2="36"
        transform={`rotate(${value * 180 - 90} 160 128)`} className="probability-gauge__tick" />)}
      <g className="probability-gauge__needle" style={{ '--gauge-angle': `${probability * 180 - 90}deg` } as CSSProperties}>
        <path d="M 156 128 L 160 42 L 164 128 Z" />
      </g>
      </g>
      <circle cx="160" cy="87.2" r="6" className="probability-gauge__hub" />
      <circle cx="160" cy="87.2" r="2.5" fill="var(--glass-white, #fff)" />
      <text x="160" y="4" className="probability-gauge__tick-label" textAnchor="middle">50%</text>
      <text x="44" y="111" className="probability-gauge__tick-label" textAnchor="middle">0%</text>
      <text x="276" y="111" className="probability-gauge__tick-label" textAnchor="middle">100%</text>
      <text x="160" y="142" className="probability-gauge__value" textAnchor="middle">{percent}%</text>
    </svg>
    <p className="probability-gauge__caption">Predicted UNSAFE filing</p>
  </div>;
}
