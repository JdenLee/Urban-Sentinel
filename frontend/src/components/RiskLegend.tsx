import type { JoinedFeature, Priority } from '../types/predictions';
import { PRIORITY_COLOR, PRIORITY_LABEL, PRIORITY_RANGE, UNSCORED_COLOR, rgbCss } from '../data/priority';

const ORDER: Priority[] = ['critical', 'high', 'medium', 'low'];

export interface RiskLegendProps {
  scored: JoinedFeature[];
  visible: Set<Priority>;
  scoreLabel: string;
  onToggle: (p: Priority) => void;
}

/** Inspection-priority legend; each row doubles as a map filter. */
export function RiskLegend({ scored, visible, scoreLabel, onToggle }: RiskLegendProps) {
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
        {ORDER.map((key) => {
          const on = visible.has(key);
          return (
            <li key={key}>
              <button
                type="button"
                className={`legend__row legend__row--btn${on ? '' : ' is-off'}`}
                aria-pressed={on}
                title={on ? `Hide ${PRIORITY_LABEL[key]} on the map` : `Show ${PRIORITY_LABEL[key]} on the map`}
                onClick={() => onToggle(key)}
              >
                <span className="swatch" style={{ background: rgbCss(PRIORITY_COLOR[key]) }} />
                <span className="legend__name">{PRIORITY_LABEL[key]}</span>
                <span className="legend__range mono">{PRIORITY_RANGE[key]}</span>
                <span className="legend__count mono">{counts[key]}</span>
              </button>
            </li>
          );
        })}
        <li className="legend__row legend__row--muted">
          <span className="swatch" style={{ background: rgbCss(UNSCORED_COLOR) }} />
          <span className="legend__name">Unscored</span>
        </li>
      </ul>
      <p className="legend__hint">Click a category to filter the map.</p>
    </div>
  );
}
