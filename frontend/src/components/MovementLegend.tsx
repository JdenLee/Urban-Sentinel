import type { DataMode, MovementMeta } from '../types/predictions';
import { MOVEMENT_COLORS, MOVEMENT_DOMAIN } from '../layers/movementHexagonLayer';

/** Separate legend for the satellite layer so its scale is never read as inspection priority. */
export function MovementLegend({ meta, mode }: { meta: MovementMeta; mode: DataMode }) {
  const gradient = `linear-gradient(90deg, ${MOVEMENT_COLORS.map((c) => `rgb(${c.join(',')})`).join(', ')})`;
  const [lo, hi] = MOVEMENT_DOMAIN;
  return (
    <div className="panel movement-legend" role="note" aria-label="Satellite movement legend">
      <div className="legend__head">
        <h3 className="section-title">Satellite movement</h3>
        {mode === 'mock' && <span className="mini-badge">Mock</span>}
      </div>
      <p className="movement-legend__what">
        Mean absolute {meta.measurement} per hexagon ({meta.units})
      </p>
      <div className="movement-legend__bar" style={{ background: gradient }} />
      <div className="movement-legend__ticks mono">
        <span>≤{lo}</span>
        <span>{((lo + hi) / 2).toFixed(1)}</span>
        <span>≥{hi} {meta.units}</span>
      </div>
      <dl className="kv kv--tight">
        {meta.period_start && meta.period_end && (
          <div className="kv__row">
            <dt>Period</dt>
            <dd className="mono">
              {meta.period_start} → {meta.period_end}
            </dd>
          </div>
        )}
        <div className="kv__row">
          <dt>Aggregation</dt>
          <dd>
            {meta.aggregation_m} m hexagons{meta.posting_m ? ` (from ${meta.posting_m} m posting)` : ''}
          </dd>
        </div>
        {meta.source && (
          <div className="kv__row">
            <dt>Source</dt>
            <dd>{meta.source}</dd>
          </div>
        )}
      </dl>
      <p className="legend__hint">Line-of-sight motion only; not reconstructed vertical settlement. Column height also encodes velocity.</p>
    </div>
  );
}
