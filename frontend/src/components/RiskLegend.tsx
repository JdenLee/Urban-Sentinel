import type { Coverage, JoinedFeature, Priority } from '../types/predictions';
import { PRIORITY_COLOR, PRIORITY_LABEL, RECORDED_ORDER, UNSCORED_COLOR, rgbCss } from '../data/priority';
import { usePress } from '../motion/usePress';

/** Order and short names for the "why not scored" breakdown (full wording comes from the export's labels). */
const REASON_ORDER: [string, string][] = [
  ['low_rise', 'Six stories or fewer (not in program)'],
  ['shared_lot', 'Filing under another building on the lot'],
  ['newer_building', 'Newer building, no filing yet'],
  ['public_owner', 'Federal / state / Port Authority'],
  ['no_filing', 'Over six stories, no filing on record'],
  ['stale', 'No filing since 2014'],
  ['unknown', 'Not enough data'],
];

const ORDER: Priority[] = ['critical', 'high', 'medium', 'low'];

/** A row is a map filter, so it fires on pointer-down: the fill changes under the finger. */
function LegendRow({ priority, on, count, range, onToggle }: {
  priority: Priority;
  on: boolean;
  count: number;
  range: string;
  onToggle: (p: Priority) => void;
}) {
  const press = usePress<HTMLButtonElement>(() => onToggle(priority));
  return (
    <button
      type="button"
      className={`legend__row legend__row--btn${on ? '' : ' is-off'}`}
      aria-pressed={on}
      title={on ? `Hide ${PRIORITY_LABEL[priority]} on the map` : `Show ${PRIORITY_LABEL[priority]} on the map`}
      {...press}
    >
      <span className="swatch" style={{ background: rgbCss(PRIORITY_COLOR[priority]) }} />
      <span className="legend__name">{PRIORITY_LABEL[priority]}</span>
      <span className="legend__range mono">{range}</span>
      <span className="legend__count mono">{count}</span>
    </button>
  );
}

export interface RiskLegendProps {
  scored: JoinedFeature[];
  /** All footprints (to count recorded outcomes) and the export's coverage reasons, when available. */
  features?: JoinedFeature[];
  coverage?: Coverage | null;
  visible: Set<Priority>;
  scoreLabel: string;
  onToggle: (p: Priority) => void;
}

/** Inspection-priority legend; each row doubles as a map filter. */
export function RiskLegend({ scored, visible, scoreLabel, onToggle, features = [], coverage = null }: RiskLegendProps) {
  const recordedCounts: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};
  for (const f of features) {
    const rec = f.properties.recorded;
    if (rec) recordedCounts[rec.status] = (recordedCounts[rec.status] ?? 0) + 1;
    else if (!f.properties.prediction && f.properties.unscoredReason) {
      reasonCounts[f.properties.unscoredReason] = (reasonCounts[f.properties.unscoredReason] ?? 0) + 1;
    }
  }
  const recordedTotal = Object.values(recordedCounts).reduce((a, b) => a + b, 0);
  const unscoredTotal = features.filter((f) => !f.properties.prediction && !f.properties.recorded).length;
  const counts = scored.reduce<Record<Priority, number>>(
    (m, f) => {
      m[f.properties.prediction!.priority]++;
      return m;
    },
    { critical: 0, high: 0, medium: 0, low: 0 },
  );

  return (
    <div className="legend">
      <div className="legend__head">
        <h3 className="section-title">Inspection priority</h3>
        <span className="legend__unit">{scoreLabel}</span>
      </div>
      <ul className="legend__rows">
        {ORDER.map((key) => (
          <li key={key}>
            <LegendRow priority={key} on={visible.has(key)} count={counts[key]} range={observedRange(scored, key)} onToggle={onToggle} />
          </li>
        ))}
        {recordedTotal > 0 &&
          RECORDED_ORDER.filter((s) => recordedCounts[s]).map((s) => (
            <li key={s} className="legend__row" title="Already filed this cycle: the inspector's recorded result, not a prediction">
              <span className="swatch" style={{ background: rgbCss(UNSCORED_COLOR) }} />
              <span className="legend__name">Recorded {s}</span>
              <span className="legend__range mono">filed this cycle</span>
              <span className="legend__count mono">{recordedCounts[s]}</span>
            </li>
          ))}
        <li className="legend__row legend__row--muted">
          <span className="swatch" style={{ background: rgbCss(UNSCORED_COLOR) }} />
          <span className="legend__name">Not scored</span>
          {unscoredTotal > 0 && <span className="legend__count mono">{unscoredTotal}</span>}
        </li>
      </ul>
      {coverage && Object.keys(reasonCounts).length > 0 && (
        <details className="legend__why">
          <summary>Why some buildings are not scored</summary>
          <ul>
            {REASON_ORDER.filter(([k]) => reasonCounts[k]).map(([k, short]) => (
              <li key={k} title={coverage.labels[k] ?? short}>
                <span>{short}</span>
                <span className="mono">{reasonCounts[k]}</span>
              </li>
            ))}
          </ul>
          <p className="legend__hint">The model only scores buildings in NYC's façade inspection program (Local Law 11).</p>
        </details>
      )}
      <p className="legend__hint">Click a category to filter. Ranges show observed scores in this export, not fixed tier thresholds. Recorded outcomes stay gray.</p>
    </div>
  );
}

export function observedRange(scored: JoinedFeature[], priority: Priority): string {
  const values = scored.map((f) => f.properties.prediction!).filter((p) => p.priority === priority).map((p) => p.score);
  if (!values.length) return 'No buildings';
  return `${Math.min(...values).toFixed(2)}–${Math.max(...values).toFixed(2)}`;
}
