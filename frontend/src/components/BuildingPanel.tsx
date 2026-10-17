import type { BuildingPrediction, JoinedFeature, MovementPoint } from '../types/predictions';
import { PRIORITY_COLOR, PRIORITY_LABEL, rgbCss } from '../data/priority';

const FACTOR_LABELS: Record<string, { label: string; unit?: string }> = {
  sar_velocity_mm_year: { label: 'SAR velocity', unit: 'mm/yr' },
  sar_acceleration_mm_year2: { label: 'SAR acceleration', unit: 'mm/yr²' },
  violations_12m: { label: 'Violations (12 mo)' },
  complaints_12m: { label: 'Façade complaints (12 mo)' },
  building_age_years: { label: 'Building age', unit: 'yr' },
};

function formatFactor(key: string, value: number | string | null) {
  const meta = FACTOR_LABELS[key];
  const label = meta?.label ?? key.replace(/_/g, ' ');
  const v = value === null ? '—' : typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value;
  return { label, value: meta?.unit && value !== null ? `${v} ${meta.unit}` : v };
}

export interface BuildingPanelProps {
  feature: JoinedFeature;
  total: number;
  onClose: () => void;
}

export function BuildingPanel({ feature, total, onClose }: BuildingPanelProps) {
  const p = feature.properties.prediction as BuildingPrediction;
  const color = rgbCss(PRIORITY_COLOR[p.priority]);
  const factors = Object.entries(p.factors);

  return (
    <aside className="panel building-panel" aria-label="Selected building" style={{ ['--accent' as string]: color }}>
      <header className="building-panel__head">
        <div>
          <div className="eyebrow">Inspection priority · Rank #{p.rank} of {total}</div>
          <h2 className="building-panel__title">{feature.properties.address ?? 'Address unavailable'}</h2>
          <div className="building-panel__bin">
            BIN <span className="mono">{feature.properties.bin}</span>
            {feature.properties.year_built ? <> · Built {feature.properties.year_built}</> : null}
            {' · '}
            {feature.properties.height_estimated ? 'Height unknown' : `${Math.round(feature.properties.height_m)} m`}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close building panel">
          ×
        </button>
      </header>

      <div className="score-row">
        <div className="score">
          <span className="score__value mono">{p.score.toFixed(2)}</span>
          <span className="score__label">score</span>
        </div>
        <div className="score-meta">
          <span className="priority-chip" style={{ background: color }}>
            {PRIORITY_LABEL[p.priority]}
          </span>
          {p.confidence !== null && (
            <span className="score-meta__conf">Confidence {Math.round(p.confidence * 100)}%</span>
          )}
        </div>
      </div>
      <div className="score-bar" aria-hidden>
        <div className="score-bar__fill" style={{ width: `${p.score * 100}%` }} />
      </div>

      {p.explanations.length > 0 && (
        <section>
          <h3 className="section-title">Elevated warning signals</h3>
          <ol className="explanations">
            {p.explanations.slice(0, 3).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ol>
        </section>
      )}

      {factors.length > 0 && (
        <section>
          <h3 className="section-title">Model factors</h3>
          <dl className="factors">
            {factors.map(([k, v]) => {
              const f = formatFactor(k, v);
              return (
                <div key={k} className="factors__row">
                  <dt>{f.label}</dt>
                  <dd className="mono">{f.value}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      <section>
        <h3 className="section-title">Satellite-derived displacement</h3>
        {p.movement_history.length >= 2 ? (
          <MovementChart points={p.movement_history} color={color} />
        ) : (
          <p className="muted small">No movement history available for this building.</p>
        )}
      </section>

      <p className="disclaimer">Decision-support tool; field inspection required. Recommended for further review — not a prediction of structural failure.</p>
    </aside>
  );
}

const CW = 320;
const CH = 120;
const PAD = { l: 34, r: 10, t: 10, b: 22 };

export function MovementChart({ points, color }: { points: MovementPoint[]; color: string }) {
  const times = points.map((p) => Date.parse(p.date));
  const vals = points.map((p) => p.displacement_mm);
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const vMin = Math.min(0, ...vals), vMax = Math.max(0, ...vals);
  const span = vMax - vMin || 1;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (CW - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((vMax - v) / span) * (CH - PAD.t - PAD.b);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(p.displacement_mm).toFixed(1)}`).join('');
  const area = `${line}L${x(t1).toFixed(1)},${y(0).toFixed(1)}L${x(t0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const last = points[points.length - 1];
  const years = [...new Set(points.map((p) => p.date.slice(0, 4)))];
  const ticks = [vMin, vMin / 2, 0].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${CW} ${CH}`} role="img" aria-label={`Cumulative displacement, latest ${last.displacement_mm} mm on ${last.date}`}>
        <defs>
          <linearGradient id="mv-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0" />
            <stop offset="1" stopColor={color} stopOpacity="0.35" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={CW - PAD.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'chart__zero' : 'chart__grid'} />
            <text x={PAD.l - 6} y={y(v) + 3} className="chart__tick" textAnchor="end">
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        {years.map((yr) => {
          const t = Date.parse(`${yr}-01-01`);
          if (t < t0 || t > t1) return null;
          return (
            <text key={yr} x={x(t)} y={CH - 6} className="chart__tick" textAnchor="middle">
              {yr}
            </text>
          );
        })}
        <path d={area} fill="url(#mv-fill)" />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(t1)} cy={y(last.displacement_mm)} r={3.5} fill={color} />
      </svg>
      <figcaption className="chart__caption">
        <span>Cumulative line-of-sight movement (mm)</span>
        <span className="mono">{last.displacement_mm > 0 ? '+' : ''}{last.displacement_mm} mm</span>
      </figcaption>
    </figure>
  );
}
