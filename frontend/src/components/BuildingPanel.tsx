import { useState } from 'react';
import type { BuildingPrediction, Contribution, JoinedFeature, ModelCard, MovementPoint } from '../types/predictions';
import { PRIORITY_COLOR, PRIORITY_LABEL, rgbCss } from '../data/priority';
import { ASSIGNMENT_LABEL, ASSIGNMENT_STATUSES, type AssignmentStatus } from '../data/shortlist';
import { LiveRescore } from './LiveRescore';

const FACTOR_LABELS: Record<string, { label: string; unit?: string }> = {
  sar_velocity_mm_year: { label: 'LOS velocity', unit: 'mm/yr' },
  sar_acceleration_mm_year2: { label: 'LOS acceleration', unit: 'mm/yr²' },
  violations_12m: { label: 'Open violations (12 mo)' },
  complaints_12m: { label: 'Façade complaints (12 mo)' },
  building_age_years: { label: 'Building age', unit: 'yr' },
  occupancy: { label: 'Occupancy / use' },
  floors: { label: 'Floors' },
  pedestrian_exposure: { label: 'Pedestrian exposure' },
};

function formatFactor(key: string, value: number | string | null) {
  const meta = FACTOR_LABELS[key];
  const label = meta?.label ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const v = value === null ? '—' : typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value;
  return { label, value: meta?.unit && value !== null ? `${v} ${meta.unit}` : v };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

type Tab = 'overview' | 'evidence' | 'records';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'records', label: 'Records & data' },
];

export interface BuildingPanelProps {
  feature: JoinedFeature;
  total: number;
  capacity: number;
  modelCard: ModelCard;
  status: AssignmentStatus;
  onStatusChange: (s: AssignmentStatus) => void;
  onOpenModelCard: () => void;
  onClose: () => void;
}

export function BuildingPanel(props: BuildingPanelProps) {
  const { feature, total, capacity, status, onStatusChange, onClose } = props;
  const p = feature.properties.prediction as BuildingPrediction;
  const color = rgbCss(PRIORITY_COLOR[p.priority]);
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <aside className="panel building-panel" aria-label="Selected building" style={{ ['--accent' as string]: color }}>
      <header className="building-panel__head">
        <div>
          <div className="eyebrow">
            Rank #{p.rank} of {total}
            {p.rank <= capacity && <span className="within-cap">Within capacity</span>}
          </div>
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

      <div className="tabs" role="tablist" aria-label="Building details">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tabs__tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="building-panel__body" role="tabpanel">
        {tab === 'overview' && <OverviewTab {...props} p={p} color={color} />}
        {tab === 'evidence' && <EvidenceTab p={p} color={color} />}
        {tab === 'records' && <RecordsTab p={p} />}
      </div>

      <footer className="building-panel__foot">
        <label className="status-select">
          <span>Inspection status</span>
          <select value={status} onChange={(e) => onStatusChange(e.target.value as AssignmentStatus)}>
            {ASSIGNMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ASSIGNMENT_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <p className="disclaimer">Decision-support tool; field inspection required. Ranks buildings for review — not a structural simulation or a prediction of failure.</p>
      </footer>
    </aside>
  );
}

function OverviewTab({ p, color, modelCard, onOpenModelCard }: BuildingPanelProps & { p: BuildingPrediction; color: string }) {
  const scoreIsProbability = p.probability !== null && Math.abs(p.probability - p.score) < 1e-9;
  const consequence = Object.entries(p.consequence);
  return (
    <>
      <section>
        <div className="score-row">
          <div className="score">
            <span className="score__value mono">{p.score.toFixed(2)}</span>
            <span className="score__label">
              {scoreIsProbability ? 'Predicted probability' : 'Priority score'}
              <button type="button" className="info-btn" onClick={onOpenModelCard} aria-label="What does this score mean?">
                i
              </button>
            </span>
          </div>
          <span className="priority-chip" style={{ background: color }}>
            {PRIORITY_LABEL[p.priority]}
          </span>
        </div>
        <ScoreBar score={p.score} interval={p.score_interval} />
        <dl className="kv">
          {!scoreIsProbability && p.probability !== null && (
            <div className="kv__row">
              <dt>Predicted 12-month probability</dt>
              <dd className="mono">{pct(p.probability)}</dd>
            </div>
          )}
          {p.score_interval && (
            <div className="kv__row">
              <dt>Uncertainty range</dt>
              <dd className="mono">
                {p.score_interval[0].toFixed(2)}–{p.score_interval[1].toFixed(2)}
              </dd>
            </div>
          )}
          {p.confidence !== null && modelCard.confidence_definition && (
            <div className="kv__row" title={modelCard.confidence_definition}>
              <dt>Confidence</dt>
              <dd className="mono">{pct(p.confidence)}</dd>
            </div>
          )}
          {p.completeness !== null && (
            <div className="kv__row">
              <dt>Input data completeness</dt>
              <dd className="mono">{pct(p.completeness)}</dd>
            </div>
          )}
        </dl>
        <p className="score-def">
          {modelCard.score_definition ?? (scoreIsProbability ? modelCard.target : null) ?? 'Normalized priority score, 0–1.'}
        </p>
      </section>

      <LiveRescore bin={p.bin} storedProbability={p.probability} />

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

      {consequence.length > 0 && (
        <section>
          <h3 className="section-title">Consequence inputs</h3>
          <FactorList entries={consequence} />
        </section>
      )}
    </>
  );
}

function EvidenceTab({ p, color }: { p: BuildingPrediction; color: string }) {
  const factors = Object.entries(p.factors);
  return (
    <>
      {p.contributions.length > 0 && (
        <section>
          <h3 className="section-title">Contribution to score</h3>
          <ContributionBars items={p.contributions.slice(0, 6)} />
        </section>
      )}

      <section>
        <h3 className="section-title">Line-of-sight displacement</h3>
        {p.movement_history.length >= 2 ? (
          <MovementChart points={p.movement_history} color={color} />
        ) : (
          <p className="muted small">No movement history for this building.</p>
        )}
        {p.angular_distortion !== null && (
          <dl className="kv">
            <div className="kv__row">
              <dt>Angular distortion (β)</dt>
              <dd className="mono">
                1/{Math.round(1 / p.angular_distortion).toLocaleString()} ({p.angular_distortion.toExponential(1)})
              </dd>
            </div>
          </dl>
        )}
      </section>

      {factors.length > 0 && (
        <section>
          <h3 className="section-title">Model inputs</h3>
          <FactorList entries={factors} />
        </section>
      )}
    </>
  );
}

function RecordsTab({ p }: { p: BuildingPrediction }) {
  return (
    <>
      <section>
        <h3 className="section-title">Record history</h3>
        {p.record_history.length ? (
          <ol className="timeline">
            {p.record_history.map((r, i) => (
              <li key={i} className="timeline__item">
                <span className="timeline__date mono">{r.date ?? '—'}</span>
                <span className="timeline__type">{r.type}</span>
                <span className="timeline__desc">{r.description}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted small">No records supplied.</p>
        )}
      </section>

      <section>
        <h3 className="section-title">Data completeness</h3>
        {p.completeness !== null ? (
          <div className="meter" aria-label={`Completeness ${pct(p.completeness)}`}>
            <div className="meter__fill" style={{ width: pct(p.completeness) }} />
            <span className="meter__label mono">{pct(p.completeness)}</span>
          </div>
        ) : (
          <p className="muted small">Not reported.</p>
        )}
        {p.missing_inputs.length > 0 && (
          <p className="small missing">Missing or uncertain: {p.missing_inputs.join(', ')}</p>
        )}
      </section>

      <section>
        <h3 className="section-title">Sources</h3>
        {p.sources.length ? (
          <dl className="kv">
            {p.sources.map((s) => (
              <div key={s.name} className="kv__row">
                <dt>{s.name}</dt>
                <dd className="mono">{s.observed_at ?? '—'}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted small">Not reported.</p>
        )}
      </section>
    </>
  );
}

function FactorList({ entries }: { entries: [string, number | string | null][] }) {
  return (
    <dl className="kv">
      {entries.map(([k, v]) => {
        const f = formatFactor(k, v);
        return (
          <div key={k} className="kv__row">
            <dt>{f.label}</dt>
            <dd className="mono">{f.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function ScoreBar({ score, interval }: { score: number; interval: [number, number] | null }) {
  return (
    <div className="score-bar" aria-hidden>
      <div className="score-bar__fill" style={{ width: `${score * 100}%` }} />
      {interval && (
        <div className="score-bar__range" style={{ left: `${interval[0] * 100}%`, width: `${(interval[1] - interval[0]) * 100}%` }} />
      )}
    </div>
  );
}

function ContributionBars({ items }: { items: Contribution[] }) {
  const max = Math.max(...items.map((c) => Math.abs(c.contribution)), 0.01);
  return (
    <>
      <ul className="contrib">
        {items.map((c) => {
          const w = (Math.abs(c.contribution) / max) * 50;
          const up = c.contribution >= 0;
          return (
            <li key={c.label} className="contrib__row">
              <span className="contrib__label" title={c.value ?? undefined}>
                {c.label}
                {c.value && <span className="contrib__value"> · {c.value}</span>}
              </span>
              <span className="contrib__track">
                <span
                  className={`contrib__bar ${up ? 'is-up' : 'is-down'}`}
                  style={up ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }}
                />
              </span>
              <span className="contrib__num mono">
                {up ? '+' : '−'}
                {Math.abs(c.contribution).toFixed(2)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="muted small chart-note">Signed log-odds contribution; right raises priority, left lowers it.</p>
    </>
  );
}

const CW = 340;
const CH = 128;
const PAD = { l: 34, r: 10, t: 10, b: 22 };

export function MovementChart({ points, color }: { points: MovementPoint[]; color: string }) {
  const times = points.map((p) => Date.parse(p.date));
  const vals = points.flatMap((p) => [p.displacement_mm, p.baseline_mm ?? 0]);
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const vMin = Math.min(0, ...vals), vMax = Math.max(0, ...vals);
  const span = vMax - vMin || 1;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (CW - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((vMax - v) / span) * (CH - PAD.t - PAD.b);
  const path = (get: (p: MovementPoint) => number) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(get(p)).toFixed(1)}`).join('');
  const line = path((p) => p.displacement_mm);
  const hasBaseline = points.some((p) => p.baseline_mm !== null);
  const baseline = hasBaseline ? path((p) => p.baseline_mm ?? 0) : null;
  const area = `${line}L${x(t1).toFixed(1)},${y(0).toFixed(1)}L${x(t0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const last = points[points.length - 1];
  const years = [...new Set(points.map((p) => p.date.slice(0, 4)))];
  const ticks = [vMin, vMin / 2, 0, vMax > 0.5 ? vMax : null].filter((v, i, a): v is number => v !== null && a.indexOf(v) === i);
  const excess = last.baseline_mm !== null ? last.displacement_mm - last.baseline_mm : null;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${CW} ${CH}`} role="img" aria-label={`Cumulative line-of-sight displacement, ${last.displacement_mm} mm on ${last.date}`}>
        <defs>
          <linearGradient id="mv-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0" />
            <stop offset="1" stopColor={color} stopOpacity="0.3" />
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
        {baseline && <path d={baseline} fill="none" className="chart__baseline" />}
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(t1)} cy={y(last.displacement_mm)} r={3.5} fill={color} />
      </svg>
      <figcaption className="chart__caption">
        <span className="chart__key">
          <i style={{ background: color }} /> Observed (mm)
          {baseline && (
            <>
              <i className="chart__key-dash" /> Seasonal/thermal baseline
            </>
          )}
        </span>
        <span className="mono">
          {points[0].date} → {last.date}
        </span>
      </figcaption>
      {excess !== null && (
        <p className="small chart-note">
          Latest observed {last.displacement_mm} mm vs baseline {last.baseline_mm} mm:{' '}
          <strong className="mono">{excess > 0 ? '+' : ''}{excess.toFixed(1)} mm</strong> beyond expected seasonal movement.
        </p>
      )}
    </figure>
  );
}
