import type { JoinedFeature, Priority } from '../types/predictions';
import { PRIORITY_COLOR, PRIORITY_LABEL, PRIORITY_THRESHOLDS, UNSCORED_COLOR, rgbCss } from '../data/priority';

const ROWS: { key: Priority; range: string }[] = [
  { key: 'critical', range: `≥ ${PRIORITY_THRESHOLDS.critical}` },
  { key: 'high', range: `${PRIORITY_THRESHOLDS.high}–${PRIORITY_THRESHOLDS.critical}` },
  { key: 'medium', range: `${PRIORITY_THRESHOLDS.medium}–${PRIORITY_THRESHOLDS.high}` },
  { key: 'low', range: `< ${PRIORITY_THRESHOLDS.medium}` },
];

export interface RiskLegendProps {
  scored: JoinedFeature[];
  selectedBin: string | null;
  onSelect: (bin: string) => void;
}

export function RiskLegend({ scored, selectedBin, onSelect }: RiskLegendProps) {
  const counts = scored.reduce<Record<Priority, number>>(
    (m, f) => {
      m[f.properties.prediction!.priority]++;
      return m;
    },
    { critical: 0, high: 0, medium: 0, low: 0 },
  );
  const top = scored.slice(0, 6);

  return (
    <div className="legend">
      <ul className="legend__rows">
        {ROWS.map(({ key, range }) => (
          <li key={key} className="legend__row">
            <span className="swatch" style={{ background: rgbCss(PRIORITY_COLOR[key]) }} />
            <span className="legend__name">{PRIORITY_LABEL[key]}</span>
            <span className="legend__range mono">{range}</span>
            <span className="legend__count mono">{counts[key]}</span>
          </li>
        ))}
        <li className="legend__row legend__row--muted">
          <span className="swatch" style={{ background: rgbCss(UNSCORED_COLOR) }} />
          <span className="legend__name">Unscored</span>
        </li>
      </ul>

      <h3 className="section-title">Top inspection priorities</h3>
      <ol className="toplist">
        {top.map((f) => {
          const p = f.properties.prediction!;
          return (
            <li key={f.properties.bin}>
              <button
                type="button"
                className={`toplist__item${selectedBin === f.properties.bin ? ' is-active' : ''}`}
                onClick={() => onSelect(f.properties.bin)}
              >
                <span className="toplist__rank mono">{p.rank}</span>
                <span className="swatch swatch--sm" style={{ background: rgbCss(PRIORITY_COLOR[p.priority]) }} />
                <span className="toplist__addr">{f.properties.address ?? `BIN ${f.properties.bin}`}</span>
                <span className="toplist__score mono">{p.score.toFixed(2)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
