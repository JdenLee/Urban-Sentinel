import { useEffect, useRef } from 'react';
import type { PredictionSet } from '../types/predictions';
import { PRIORITY_RANGE } from '../data/priority';

const fmtDate = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
};

/** Model card: what the score means, how it was validated, and its limits. */
export function ModelCardDialog({ predictions, onClose }: { predictions: PredictionSet; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const { model, model_card: card, data_mode } = predictions;
  const isMock = data_mode === 'mock';

  return (
    <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="modal__inner">
        <header className="modal__head">
          <div>
            <div className="eyebrow">Model card</div>
            <h2 className="modal__title">{model.name}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close model card">
            ×
          </button>
        </header>

        {isMock && (
          <p className="notice">
            Mock predictions are loaded. Scores are synthetic; metrics below are filled in by the backend export.
          </p>
        )}

        <section>
          <h3 className="section-title">Prediction target</h3>
          <p>{card.target ?? 'Not specified in the prediction file.'}</p>
        </section>
        <section>
          <h3 className="section-title">What the score means</h3>
          <p>{card.score_definition ?? 'Normalized priority score from 0 to 1. Higher means review sooner.'}</p>
          <p className="muted small">
            Categories: Critical {PRIORITY_RANGE.critical} · High {PRIORITY_RANGE.high} · Medium {PRIORITY_RANGE.medium} · Low{' '}
            {PRIORITY_RANGE.low}
          </p>
          {card.confidence_definition && <p className="muted small">Confidence: {card.confidence_definition}</p>}
        </section>

        <section>
          <h3 className="section-title">Validation</h3>
          {card.metrics.length ? (
            <dl className="kv">
              {card.metrics.map((m) => (
                <div key={m.label} className="kv__row">
                  <dt>{m.label}</dt>
                  <dd className={m.value ? 'mono' : 'muted'}>{m.value ?? 'Pending backend export'}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted small">No backtest metrics in the prediction file.</p>
          )}
        </section>

        <section>
          <h3 className="section-title">Provenance</h3>
          <dl className="kv">
            <div className="kv__row">
              <dt>Model version</dt>
              <dd className="mono">{model.version}</dd>
            </div>
            <div className="kv__row">
              <dt>{isMock ? 'Target runtime' : 'Scored on'}</dt>
              <dd>{model.execution_platform}</dd>
            </div>
            <div className="kv__row">
              <dt>Trained through</dt>
              <dd className="mono">{fmtDate(model.trained_through)}</dd>
            </div>
            <div className="kv__row">
              <dt>Data as of</dt>
              <dd className="mono">{fmtDate(predictions.data_as_of)}</dd>
            </div>
            <div className="kv__row">
              <dt>Last refresh</dt>
              <dd className="mono">{fmtDate(predictions.generated_at)}</dd>
            </div>
          </dl>
        </section>

        {card.limitations.length > 0 && (
          <section>
            <h3 className="section-title">Limitations</h3>
            <ul className="bullets">
              {card.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </dialog>
  );
}
