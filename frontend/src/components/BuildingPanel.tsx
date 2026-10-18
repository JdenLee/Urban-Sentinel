import { useMemo, useState, type ReactNode } from 'react';
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
import { DOB_NOW_PORTAL_URL, cycleFromDescription, dobBisFacadesUrl, dobBisProfileUrl, openDataFilingUrl } from '../data/recordLinks';
import { LiveRescore } from './LiveRescore';
import { BuildingProfile } from './BuildingProfile';
import { buildingName, landmarkFor } from '../data/landmarks';
import type { Geometry } from 'geojson';
import { useDragSheet } from '../motion/useDragSheet';
import { useMediaQuery } from '../motion/useMediaQuery';
import { usePress } from '../motion/usePress';
import { HistoryReplay } from './HistoryReplay';

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
const TAB_LABEL: Record<Tab, string> = { overview: 'Summary', evidence: 'Why this score?', history: 'History' };

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
      id={`building-tab-${tab}`}
      aria-controls="building-tab-panel"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={`tabs__tab${active ? ' is-active' : ''}`}
      {...press}
      onKeyDown={(e) => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        e.preventDefault();
        const order: Tab[] = ['overview', 'evidence', 'history'];
        const index = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (order.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
        onSelect(order[index]);
        document.getElementById(`building-tab-${order[index]}`)?.focus();
      }}
    >
      {TAB_LABEL[tab]}
    </button>
  );
}

/** How many timeline entries to show before "Show all". */
const TIMELINE_PREVIEW = 40;

export interface BuildingPanelProps {
  isMock?: boolean;
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
  /** Coverage reason wording from the export, for buildings without a score. */
  coverageLabels?: Record<string, string> | null;
  /** Footprint geometry for the aerial photo: the scene's, or the one fetched for a looked-up building. */
  geometry?: Geometry | null;
  /** Roof height in metres for buildings without a scene footprint (from the fetched footprint). */
  geometryHeightM?: number | null;
  onClose: () => void;
}

function eyebrowFor(p: BuildingPrediction | null, history: HistoryState, total: number, scope: 'area' | 'citywide'): string {
  if (p) return `Rank #${p.rank.toLocaleString()} of ${(p.rank_total ?? total).toLocaleString()} ${scope === 'citywide' ? 'citywide' : 'in this export'}`;
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
  // Real imagery and lot facts. A scored building leads with its score, so this follows it there.
  const profile = (
    <BuildingProfile
      bin={bin}
      geometry={props.geometry ?? feature?.geometry ?? null}
      heightM={feature?.properties.height_m ?? props.geometryHeightM ?? 0}
      landmark={landmark}
      knownFloors={feature?.properties.floors ?? null}
    />
  );
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

      <div className="building-panel__body" role="tabpanel" id="building-tab-panel" aria-labelledby={tabs.length > 1 ? `building-tab-${active}` : undefined} aria-label={tabs.length === 1 ? 'Building history' : undefined}>
        {!p && <details className="detail-fold"><summary>Building photo &amp; facts</summary>{profile}</details>}
        {!p && <NoScoreNotice feature={feature} bin={bin} labels={props.coverageLabels} />}
        {active === 'overview' && p && <OverviewTab {...props} p={p} color={color} profile={profile} />}
        {active === 'evidence' && p && <EvidenceTab p={p} />}
        {active === 'history' && <HistoryTab p={p} history={history} color={color} bin={bin} isMock={props.isMock ?? false} />}
        {p && rankScope === 'area' && (
          <details className="detail-fold"><summary>Inspection workflow</summary>
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
          </details>
        )}
        {landmark && <p className="landmark-source">{landmark.model && 'Illustrative shape, not a surveyed mesh. '}<a href={landmark.source} target="_blank" rel="noreferrer">About this landmark ↗</a></p>}
      </div>

      <footer className="building-panel__foot">
        <p className="disclaimer">
          Inspection support, not a collapse prediction. Field inspection required.
        </p>
      </footer>
    </aside>
  );
}

function OverviewTab({ p, color, modelCard, onOpenModelCard, profile }: BuildingPanelProps & { p: BuildingPrediction; color: string; profile: ReactNode }) {
  const scoreIsProbability = p.probability !== null && Math.abs(p.probability - p.score) < 1e-9;
  const consequence = Object.entries(p.consequence);
  return (
    <>
      <section>
        <div className="score-row">
          <div className="score">
            <span className="score__value">{scoreIsProbability ? pct(p.probability!) : p.score.toFixed(2)}</span>
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
        {scoreIsProbability && <div className="probability-scale"><span>0%</span><span>Predicted UNSAFE filing</span><span>100%</span></div>}
        <p className="score-def">
          {scoreIsProbability ? 'Estimated chance of an UNSAFE rating in the next Initial FISP façade filing. Not the chance of collapse.' : 'A relative score for prioritizing field inspection, not a probability of collapse.'}
        </p>

      </section>

      {p.explanations.length > 0 && p.contributions.length === 0 && (
        <section>
          <h3 className="section-title">At a glance</h3>
          <ol className="explanations">
            {p.explanations.slice(0, 3).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ol>
        </section>
      )}

      {p.contributions.length > 0 && <section>
        <h3 className="section-title">What moved the prediction?</h3>
        <ContributionBars items={[...p.contributions].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3)} />
      </section>}
        <details className="detail-fold"><summary>Score quality &amp; uncertainty</summary>
        <p className="muted small">{modelCard.score_definition ?? modelCard.target ?? 'Normalized priority score, 0–1.'}</p>
        <dl className="kv">
          {!scoreIsProbability && p.probability !== null && (
            <div className="kv__row">
              <dt>Predicted probability</dt>
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
        </details>
      <details className="detail-fold"><summary>Building photo &amp; facts</summary>{profile}<p className="muted small">Source footprints and roof heights, where available. Façade textures and landmark geometry are illustrative, not a survey.</p></details>
      <details className="detail-fold"><summary>Run a live prediction · LinuxONE</summary>
        <LiveRescore bin={p.bin} storedProbability={p.probability} />
      </details>
      {consequence.length > 0 && (
        <details className="detail-fold"><summary>Exposure &amp; consequence inputs</summary>
          <FactorList entries={consequence} />
        </details>
      )}
    </>
  );
}

function EvidenceTab({ p }: { p: BuildingPrediction }) {
  const factors = Object.entries(p.factors);
  return (
    <>
      <section className="model-story">
        <h3 className="section-title">How this prediction is made</h3>
        <ol><li><strong>1</strong><span>Records before the cutoff<small>Filings, violations and building attributes</small></span></li>
          <li><strong>2</strong><span>Decision trees add evidence<small>XGBoost combines small tree contributions</small></span></li>
          <li><strong>3</strong><span>A calibrated probability<small>Estimated chance of an UNSAFE Initial FISP filing</small></span></li></ol>
        <p className="muted small">This is an ensemble, not a single decision tree. The available export contains feature contributions, not individual tree paths.</p>
      </section>
      {p.contributions.length > 0 && (
        <section>
          <h3 className="section-title">What raised or lowered the prediction?</h3>
          <ContributionBars items={[...p.contributions].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 6)} />
          {p.contributions.length > 6 && <details className="detail-fold"><summary>All exported contributions ({p.contributions.length})</summary><ContributionBars items={p.contributions} /></details>}
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
        <details className="detail-fold"><summary>Available input details ({factors.length})</summary>
          <FactorList entries={factors} />
        </details>
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
  if (history.status === 'error') return <p className="notice">Live history is unavailable. Showing saved export records where available; these may be incomplete.</p>;
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

function MovementSection({ data, p, color, synthetic = false }: { data: BuildingHistory | null; p: BuildingPrediction | null; color: string; synthetic?: boolean }) {
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
      <h3 className="section-title">Ground movement ({synthetic ? 'synthetic demo' : 'satellite, measured'})</h3>
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

function Timeline({ records, bin }: { records: RecordEvent[]; bin: string }) {
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
            <span className="timeline__desc">
              {r.description}
              <FilingLink record={r} bin={bin} />
            </span>
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

/** Why a footprint has no prediction: its recorded result this cycle, or the coverage reason from the export. */
function NoScoreNotice({ feature, bin, labels }: { feature: JoinedFeature | null; bin: string; labels?: Record<string, string> | null }) {
  const rec = feature?.properties.recorded ?? null;
  if (rec) {
    const url = openDataFilingUrl({ bin, cycle: rec.cycle, reference: rec.reference });
    return (
      <section className="coverage-notice">
        <h3 className="section-title">Already inspected this cycle</h3>
        <p>
          Cycle {rec.cycle ?? '—'} façade report filed{rec.filed_on ? ` ${rec.filed_on}` : ''}: recorded <strong>{rec.status}</strong>. The outcome is
          known, so no prediction is needed.
          {url && (
            <>
              {' '}
              <a className="record-link" href={url} target="_blank" rel="noopener noreferrer">View filing ↗</a>
            </>
          )}
        </p>
      </section>
    );
  }
  const reason = feature?.properties.unscoredReason ?? null;
  return (
    <section className="coverage-notice">
      <h3 className="section-title">No model score</h3>
      <p>
        {reason && labels?.[reason]
          ? `${labels[reason]}. The model scores buildings in NYC's façade inspection program; this is not a low-risk rating.`
          : 'This building is mapped, but no prediction is available in the loaded data. Unscored does not mean low risk.'}
      </p>
    </section>
  );
}

/** "View filing" for FISP records: the exact row on NYC Open Data (by TR6 number, else BIN + cycle). */
function FilingLink({ record, bin }: { record: RecordEvent; bin: string }) {
  if (record.type !== 'FISP filing') return null;
  const url = openDataFilingUrl({ bin, cycle: record.cycle ?? cycleFromDescription(record.description), reference: record.reference });
  if (!url) return null;
  return (
    <a className="record-link" href={url} target="_blank" rel="noopener noreferrer" title="Open this filing in NYC Open Data (official DOB data)">
      View filing ↗
    </a>
  );
}

/** Building-level links to the official DOB systems the records come from. */
function OfficialRecords({ bin }: { bin: string }) {
  const facades = dobBisFacadesUrl(bin);
  const profile = dobBisProfileUrl(bin);
  const allFilings = openDataFilingUrl({ bin });
  if (!facades && !profile) return null;
  return (
    <section>
      <h3 className="section-title">Official records</h3>
      <ul className="record-links">
        {facades && (
          <li>
            <a href={facades} target="_blank" rel="noopener noreferrer">DOB façade filings (BIS) ↗</a>
            <span className="muted small"> every FISP cycle for this BIN; reports before 2016 in full</span>
          </li>
        )}
        {allFilings && (
          <li>
            <a href={allFilings} target="_blank" rel="noopener noreferrer">All façade filings on NYC Open Data ↗</a>
            <span className="muted small"> TR6 reports, statuses and inspection dates</span>
          </li>
        )}
        {profile && (
          <li>
            <a href={profile} target="_blank" rel="noopener noreferrer">DOB property profile (BIS) ↗</a>
            <span className="muted small"> complaints, violations and permits</span>
          </li>
        )}
        <li>
          <a href={DOB_NOW_PORTAL_URL} target="_blank" rel="noopener noreferrer">DOB NOW Public Portal ↗</a>
          <span className="muted small"> newer façade reports (search by BIN {bin})</span>
        </li>
      </ul>
    </section>
  );
}

function HistoryTab({ p, history, color, bin, isMock }: { p: BuildingPrediction | null; history: HistoryState; color: string; bin: string; isMock: boolean }) {
  const data = history.status === 'ready' ? history.data : null;
  // Without the API, fall back to whatever the prediction file carries (the mock data has records and movement).
  const records = data ? data.records : (p?.record_history ?? []);
  const sources = data ? data.sources : (p?.sources ?? []);
  return (
    <>
      <HistoryNotice history={history} />
      <HistoryReplay records={records} points={data?.movement?.points ?? p?.movement_history ?? []} isMock={isMock && !data} source={data?.movement?.meta.source ?? null} />
      {data && <FispSummary data={data} />}
      <details className="detail-fold"><summary>Satellite measurement details</summary><MovementSection data={data} p={p} color={color} synthetic={isMock && !data} /></details>
      {(data || records.length > 0) && (
        <details className="detail-fold"><summary>All source records ({records.length})</summary>
          <Timeline records={records} bin={bin} />
        </details>
      )}
      <details className="detail-fold"><summary>Open official NYC records</summary><OfficialRecords bin={bin} /></details>
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
              <span className="contrib__label" title={`${c.label}${c.value ? ': ' + c.value : ''}`}>
                {plainFeatureLabel(c.label)}
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
      <p className="muted small chart-note">← Lowers prediction · Raises prediction →<br />Contributions are in log-odds, not percentage points or causes.</p>
    </>
  );
}

/** Presentation wording only; original labels remain in the hover text and raw-input disclosure. */
function plainFeatureLabel(label: string) {
  const labels: Record<string, string> = {
    'Status on record now': 'Recorded façade status',
    'Tax-lot size, sq ft (very large = multi-building development)': 'Tax-lot area (sq ft)',
    'DOB violations (façade / Local Law 11), all prior': 'Prior façade violations',
  };
  return labels[label] ?? label;
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
