import { useMemo, useState } from 'react';
import type {
  BuildingHistory,
  BuildingPrediction,
  Contribution,
  HistoryState,
  JoinedFeature,
  ModelCard,
  MovementPoint,
  RecordEvent,
  SourceRef,
} from '../types/predictions';
import { PRIORITY_COLOR, PRIORITY_LABEL, SELECTED_COLOR, rgbCss } from '../data/priority';
import { ASSIGNMENT_LABEL, ASSIGNMENT_STATUSES, type AssignmentStatus } from '../data/shortlist';
import { RECORD_TYPES } from '../data/loadHistory';
import { LiveRescore } from './LiveRescore';
import { buildingName, landmarkFor } from '../data/landmarks';
import { useDragSheet } from '../motion/useDragSheet';
import { useMediaQuery } from '../motion/useMediaQuery';
import { usePress } from '../motion/usePress';

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

export type Tab = 'overview' | 'evidence' | 'history';
const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', evidence: 'Evidence', history: 'History' };

/** Scored buildings get the model tabs; every building gets its recorded history. */
export function panelTabs(scored: boolean): Tab[] {
  return scored ? ['overview', 'evidence', 'history'] : ['history'];
}

/** Separate component so each tab can own the pointer-down hook; the panel switches before the lift. */
function TabButton({ tab, active, onSelect }: { tab: Tab; active: boolean; onSelect: (t: Tab) => void }) {
  const press = usePress<HTMLButtonElement>(() => onSelect(tab));
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`tabs__tab${active ? ' is-active' : ''}`}
      {...press}
    >
      {TAB_LABEL[tab]}
    </button>
  );
}

/** How many timeline entries to show before "Show all". */
const TIMELINE_PREVIEW = 40;

export interface BuildingPanelProps {
  bin: string;
  /** Footprint in the scene (scored or context), if any. */
  feature: JoinedFeature | null;
  /** From the scene's predictions or, for buildings outside it, from the history record. */
  prediction: BuildingPrediction | null;
  history: HistoryState;
  /** Search label to show while the history loads, for buildings without a footprint in the scene. */
  fallbackTitle: string | null;
  /** Where the rank comes from: the scene's export ("in this area") or the API's citywide record. */
  rankScope: 'area' | 'citywide';
  total: number;
  capacity: number;
  modelCard: ModelCard;
  status: AssignmentStatus;
  onStatusChange: (s: AssignmentStatus) => void;
  onOpenModelCard: () => void;
  onClose: () => void;
}

function eyebrowFor(p: BuildingPrediction | null, history: HistoryState, total: number, scope: 'area' | 'citywide'): string {
  if (p) return `Rank #${p.rank.toLocaleString()} of ${(p.rank_total ?? total).toLocaleString()} ${scope === 'citywide' ? 'citywide' : 'in this area'}`;
  if (history.status === 'loading') return 'Loading records…';
  if (history.status !== 'ready') return 'Building';
  if (!history.data.inFisp) return 'Not in the façade inspection program';
  return history.data.fisp?.currentCycleFiled ? 'FISP building · filed this cycle' : 'FISP building · not scored';
}

export function BuildingPanel(props: BuildingPanelProps) {
  const { bin, feature, prediction: p, history, fallbackTitle, rankScope, total, capacity, status, onStatusChange, onClose } = props;
  const color = rgbCss(p ? PRIORITY_COLOR[p.priority] : SELECTED_COLOR);
  const tabs = panelTabs(p !== null);
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const active = tabs.includes(tab) ? tab : tabs[0];
  const data = history.status === 'ready' ? history.data : null;
  const address = feature?.properties.address ?? data?.address ?? p?.address ?? fallbackTitle ?? 'Address unavailable';
  const landmark = landmarkFor(bin);
  const onRecord = data?.fisp?.statusOnRecord ?? null;

  // Below this width glass.css lays the record out as a bottom sheet, which is the only form that
  // can be dragged away. Asking the same query the stylesheet used keeps the two in step.
  const isSheet = useMediaQuery('(max-width: 760px)');
  const { sheetRef, grabberProps } = useDragSheet(isSheet, onClose);

  return (
    <aside ref={sheetRef} className="panel building-panel" aria-label="Selected building" style={{ ['--accent' as string]: color }}>
      <button type="button" className="sheet-grabber" aria-label="Drag down to close" {...grabberProps} />
      <header className="building-panel__head">
        <div>
          <div className="eyebrow">
            {eyebrowFor(p, history, total, rankScope)}
            {p && rankScope === 'area' && p.rank > 0 && p.rank <= capacity && <span className="within-cap">Within capacity</span>}
          </div>
          <h2 className="building-panel__title">{buildingName(bin, address)}</h2>
          {landmark && <p className="building-panel__address">{landmark.address}</p>}
          <div className="building-panel__bin">
            BIN <span className="mono">{bin}</span>
            {data?.borough ? <> · {data.borough}</> : null}
            {(landmark?.completed ?? feature?.properties.year_built) ? <> · Built {landmark?.completed ?? feature?.properties.year_built}</> : null}
            {feature && (
              <>
                {' · '}
                {landmark?.architecturalHeight ? `${landmark.architecturalHeight.toFixed(0)} m incl. spire` : feature.properties.height_estimated ? 'Height unknown' : `${Math.round(feature.properties.height_m)} m`}
              </>
            )}
            {onRecord && (
              <span className={`record-tag record-tag--${onRecord.toLowerCase().replace(/\W+/g, '-')}`}>
                On record: {onRecord}
              </span>
            )}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close building panel">
          ×
        </button>
      </header>

      {tabs.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Building details">
          {tabs.map((t) => (
            <TabButton key={t} tab={t} active={active === t} onSelect={setTab} />
          ))}
        </div>
      )}

      <div className="building-panel__body" role="tabpanel">
        {!p && (
          <section className="coverage-notice">
            <h3 className="section-title">No model score available</h3>
            <p>This building is mapped, but no prediction is available in the loaded data. Unscored does not mean low risk.</p>
          </section>
        )}
        {active === 'overview' && p && <OverviewTab {...props} p={p} color={color} />}
        {active === 'evidence' && p && <EvidenceTab p={p} />}
        {active === 'history' && <HistoryTab p={p} history={history} color={color} />}
        {landmark && <p className="landmark-source"><a href={landmark.source} target="_blank" rel="noreferrer">About this landmark ↗</a></p>}
      </div>

      <footer className="building-panel__foot">
        {p && rankScope === 'area' && (
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
        )}
        <p className="disclaimer">
          Decision-support tool; field inspection required. Ranks buildings for review — not a structural simulation or
          a prediction of failure.
        </p>
        <p className="geometry-note">{landmark?.model ? 'Illustrative landmark model. Façade detail is approximate.' : 'Building shapes and close-up façade details are approximate.'}</p>
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

function EvidenceTab({ p }: { p: BuildingPrediction }) {
  const factors = Object.entries(p.factors);
  return (
    <>
      {p.contributions.length > 0 && (
        <section>
          <h3 className="section-title">Contribution to score</h3>
          <ContributionBars items={p.contributions.slice(0, 6)} />
        </section>
      )}
      {p.angular_distortion !== null && (
        <section>
          <dl className="kv">
            <div className="kv__row">
              <dt>Angular distortion (β)</dt>
              <dd className="mono">
                1/{Math.round(1 / p.angular_distortion).toLocaleString()} ({p.angular_distortion.toExponential(1)})
              </dd>
            </div>
          </dl>
        </section>
      )}
      {factors.length > 0 && (
        <section>
          <h3 className="section-title">Model inputs</h3>
          <FactorList entries={factors} />
        </section>
      )}
      <p className="muted small">Ground-movement history is on the History tab; it is context, not a model input.</p>
    </>
  );
}

function HistoryNotice({ history }: { history: HistoryState }) {
  if (history.status === 'loading') {
    return (
      <p className="muted small">
        <span className="spinner" aria-hidden /> Loading filings, violations, complaints and ground movement…
      </p>
    );
  }
  if (history.status === 'unavailable') {
    return (
      <p className="notice">
        Building history is unavailable. You can still explore the map and available scores.
      </p>
    );
  }
  if (history.status === 'error') return <p className="notice">Building history could not be loaded right now. Available map data is still shown.</p>;
  return null;
}

function FispSummary({ data }: { data: BuildingHistory }) {
  if (!data.fisp) return null;
  const f = data.fisp;
  return (
    <section>
      <h3 className="section-title">Façade inspection program</h3>
      <dl className="kv">
        <div className="kv__row">
          <dt>Status on record</dt>
          <dd className="mono">{f.statusOnRecord ?? '—'}</dd>
        </div>
        {f.currentCycle !== null && (
          <div className="kv__row">
            <dt>Cycle {f.currentCycle} filed</dt>
            <dd className="mono">{f.currentCycleFiled === null ? '—' : f.currentCycleFiled ? 'Yes' : 'Not yet'}</dd>
          </div>
        )}
        {f.filingWindowCloses && (
          <div className="kv__row">
            <dt>Filing window closes</dt>
            <dd className="mono">{f.filingWindowCloses}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function MovementSection({ data, p, color }: { data: BuildingHistory | null; p: BuildingPrediction | null; color: string }) {
  const m = data?.movement ?? null;
  const points = m?.points ?? (p && p.movement_history.length >= 2 ? p.movement_history : []);
  if (points.length < 2) {
    return data ? (
      <section>
        <h3 className="section-title">Ground movement (satellite, measured)</h3>
        <p className="muted small">No satellite movement series for this building.</p>
      </section>
    ) : null;
  }
  return (
    <section>
      <h3 className="section-title">Ground movement (satellite, measured)</h3>
      <MovementChart points={points} color={color} baselineLabel={m?.meta.baseline_label ?? undefined} />
      {m && (
        <>
          {m.velocityHp !== null && (
            <dl className="kv">
              <div className="kv__row">
                <dt>Building vs neighbourhood, LOS</dt>
                <dd className="mono">
                  {m.velocityHp > 0 ? '+' : ''}
                  {m.velocityHp.toFixed(1)} mm/yr
                </dd>
              </div>
            </dl>
          )}
          <p className="muted small chart-note">
            Measured by {m.meta.source}
            {m.meta.period_start && m.meta.period_end ? `, observed ${m.meta.period_start} → ${m.meta.period_end}` : ''}.{' '}
            {m.meta.sign ? `${m.meta.sign}. ` : ''}
            {m.meta.note}
          </p>
        </>
      )}
    </section>
  );
}

function Timeline({ records }: { records: RecordEvent[] }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of records) c.set(r.type, (c.get(r.type) ?? 0) + 1);
    return c;
  }, [records]);
  const types = [...RECORD_TYPES.filter((t) => counts.has(t)), ...[...counts.keys()].filter((t) => !(RECORD_TYPES as readonly string[]).includes(t))];
  const shown = filter ? records.filter((r) => r.type === filter) : records;
  const visible = showAll ? shown : shown.slice(0, TIMELINE_PREVIEW);
  if (!records.length) return <p className="muted small">No records on file.</p>;
  return (
    <>
      {types.length > 1 && (
        <div className="chips" role="group" aria-label="Filter records by type">
          <button type="button" className={`chip${filter === null ? ' is-active' : ''}`} onClick={() => setFilter(null)}>
            All <span className="mono">{records.length}</span>
          </button>
          {types.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${filter === t ? ' is-active' : ''}`}
              onClick={() => setFilter(filter === t ? null : t)}
            >
              {t} <span className="mono">{counts.get(t)}</span>
            </button>
          ))}
        </div>
      )}
      <ol className="timeline">
        {visible.map((r, i) => (
          <li key={i} className="timeline__item">
            <span className="timeline__date mono">{r.date ?? '—'}</span>
            <span className="timeline__type">{r.type}</span>
            <span className="timeline__desc">{r.description}</span>
          </li>
        ))}
      </ol>
      {shown.length > visible.length && (
        <button type="button" className="btn btn--block" onClick={() => setShowAll(true)}>
          Show all {shown.length} records
        </button>
      )}
    </>
  );
}

function SourcesList({ sources }: { sources: SourceRef[] }) {
  if (!sources.length) return <p className="muted small">Not reported.</p>;
  return (
    <dl className="kv">
      {sources.map((s) => (
        <div key={s.name} className="kv__row">
          <dt>{s.name}</dt>
          <dd className="mono">{s.observed_at ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function HistoryTab({ p, history, color }: { p: BuildingPrediction | null; history: HistoryState; color: string }) {
  const data = history.status === 'ready' ? history.data : null;
  // Without the API, fall back to whatever the prediction file carries (the mock data has records and movement).
  const records = data ? data.records : (p?.record_history ?? []);
  const sources = data ? data.sources : (p?.sources ?? []);
  return (
    <>
      <HistoryNotice history={history} />
      {data && <FispSummary data={data} />}
      <MovementSection data={data} p={p} color={color} />
      {(data || records.length > 0) && (
        <section>
          <h3 className="section-title">Record history</h3>
          <Timeline records={records} />
        </section>
      )}
      {p && p.completeness !== null && (
        <section>
          <h3 className="section-title">Data completeness</h3>
          <div className="meter" aria-label={`Completeness ${pct(p.completeness)}`}>
            <div className="meter__fill" style={{ width: pct(p.completeness) }} />
            <span className="meter__label mono">{pct(p.completeness)}</span>
          </div>
          {p.missing_inputs.length > 0 && <p className="small missing">Missing or uncertain: {p.missing_inputs.join(', ')}</p>}
        </section>
      )}
      {(data || sources.length > 0) && (
        <section>
          <h3 className="section-title">Sources</h3>
          <SourcesList sources={sources} />
        </section>
      )}
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

export function MovementChart({
  points,
  color,
  baselineLabel,
}: {
  points: MovementPoint[];
  color: string;
  /** Label for the dashed comparison line; defaults to the mock data's seasonal/thermal baseline. */
  baselineLabel?: string;
}) {
  const baseLabel = baselineLabel ?? 'Seasonal/thermal baseline';
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
              <i className="chart__key-dash" /> {baseLabel}
            </>
          )}
        </span>
        <span className="mono">
          {points[0].date} → {last.date}
        </span>
      </figcaption>
      {/* Single-date comparison only for the mock's seasonal baseline; measured series are noisy per date. */}
      {excess !== null && !baselineLabel && (
        <p className="small chart-note">
          Latest observed {last.displacement_mm} mm vs {baseLabel.toLowerCase()} {last.baseline_mm} mm:{' '}
          <strong className="mono">{excess > 0 ? '+' : ''}{excess.toFixed(1)} mm</strong>{' '}
          {baselineLabel ? 'relative to its surroundings.' : 'beyond expected seasonal movement.'}
        </p>
      )}
    </figure>
  );
}
