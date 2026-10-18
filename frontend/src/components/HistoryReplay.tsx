import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { MovementPoint, RecordEvent } from '../types/predictions';
import { facadeHistory, facadeChange, FACADE_RATINGS, historyAt, historyDates, recordDate, type FacadeObservation } from '../data/historyReplay';
import { historyIndex } from '../data/demoScript';
import { chartPrediction, conditionChartData, conditionRevealDuration, conditionY, conditionColor, CONDITION_DOT_MS, CONDITION_LINE_MS, CONDITION_FORECAST_DELAY_MS, CONDITION_FORECAST_MS, type ConditionPrediction } from '../data/conditionChart';
import { afterChartReveal } from '../motion/chartReveal';

export function HistoryReplay({ records, points, isMock, source, demoProgress, active = true, onChartComplete, prediction }: {
  records: RecordEvent[]; points: MovementPoint[]; isMock: boolean; source: string | null; demoProgress?: number; active?: boolean;
  onChartComplete?: () => void;
  prediction?: ConditionPrediction | null;
}) {
  const dates = useMemo(() => historyDates(records, points), [records, points]);
  const fullFilings = useMemo(() => facadeHistory(records, dates.at(-1) ?? ''), [records, dates]);
  const [index, setIndex] = useState(() => dates.length - 1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => { setIndex(dates.length - 1); setPlaying(false); }, [dates]);
  useEffect(() => {
    if (demoProgress !== undefined) { setPlaying(false); setIndex(historyIndex(demoProgress, dates.length)); }
  }, [demoProgress, dates]);
  useEffect(() => { if (!active) setPlaying(false); }, [active]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setIndex((i) => {
      if (i >= dates.length - 1) { setPlaying(false); return i; }
      return i + 1;
    }), 1300 / speed);
    const stop = (e: KeyboardEvent) => { if (e.key === 'Escape') setPlaying(false); };
    window.addEventListener('keydown', stop);
    return () => { clearInterval(timer); window.removeEventListener('keydown', stop); };
  }, [playing, speed, dates.length]);
  // Apply the tour cutoff in this render, before a completion effect can observe the prior frame.
  const displayedIndex = demoProgress === undefined ? index : historyIndex(demoProgress, dates.length);
  const date = dates[Math.max(0, Math.min(displayedIndex, dates.length - 1))];
  if (!date) return <section data-demo="history">
    <p className="notice">No dated observations available to replay. Connect the history service to load municipal records.</p>
    {active && <ConditionChart observations={[]} domain={['', '']} prediction={prediction} onRevealComplete={onChartComplete} />}
  </section>;
  const at = historyAt(records, points, date);
  const undated = records.filter((r) => !recordDate(r.date)).length;
  const latest = at.records[0];
  const movement = at.points.at(-1);
  const filings = facadeHistory(records, date);
  const change = facadeChange(filings);
  return <section className="history-replay" aria-label="Historical record playback" data-demo="history">
    <div className="section-title">{isMock ? 'Synthetic history demo' : 'Recorded history'}</div>
    <div className="replay-date" aria-live="polite" aria-atomic="true">{date}</div>
    {latest && <div className="replay-event"><span>{latest.date} · {latest.type}</span><p>{latest.description}</p></div>}
    <div className="replay-controls">
      <button type="button" className="btn btn--primary" disabled={dates.length < 2} onClick={() => {
        if (!playing && index >= dates.length - 1) setIndex(0);
        setPlaying((v) => !v);
      }}>{playing ? 'Pause' : 'Play history'}</button>
      <label>Speed <select aria-label="Playback speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
        <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
      </select></label>
    </div>
    <input type="range" min={0} max={Math.max(0, dates.length - 1)} value={Math.max(0, displayedIndex)}
      aria-label="Historical observation date" aria-valuetext={date}
      onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} />
    <div className="replay-endpoints"><span>{dates[0]}</span><span>{dates.at(-1)}</span></div>
    <div data-demo="history-charts">
      <ConditionStory change={change} isMock={isMock} />
      {active && <ConditionChart observations={filings} domain={[fullFilings[0]?.date ?? date, fullFilings.at(-1)?.date ?? date]}
        prediction={prediction} showPrediction={displayedIndex >= dates.length - 1} onRevealComplete={onChartComplete} />}
    </div>
    <div className="history-stats">
      <div><strong>{at.records.length}</strong><span>records by this date</span></div>
      <div><strong>{movement ? movement.displacement_mm.toFixed(1) : '—'}<small> mm</small></strong>
        <span>{movement ? `LOS displacement · ${movement.date}` : 'No satellite observation yet'}</span></div>
    </div>
    {at.points.length > 1 && <DisplacementPreview points={at.points} />}
    <p className="muted small">The slider steps through observed dates; charts use elapsed calendar time. More records do not mean worse condition. {undated > 0 ? `${undated} undated records excluded. ` : ''}
      Present-day building shapes and predictions stay unchanged. This is a records replay, not a structural simulation.</p>
    {points.length > 0 && <p className="muted small">{isMock ? 'Synthetic satellite values.' : `Satellite source: ${source ?? 'see source metadata'}. Line-of-sight displacement, not building deformation.`}</p>}
  </section>;
}

export function ConditionStory({ change, isMock = false }: { change: ReturnType<typeof facadeChange>; isMock?: boolean }) {
  return <div className={`condition-story condition-story--${change.rating?.toLowerCase() ?? 'unknown'}`}>
    <div className="condition-story__heading">
      <span className="eyebrow">{isMock ? 'Synthetic filing ratings' : 'Façade filing ratings'}</span>
      <span className="condition-story__rating">{change.rating ?? 'Uncertain'}</span>
    </div>
    <strong>{change.headline}</strong><p>{change.detail}</p>
    <small>Describes recorded filings, not the building’s condition today.</small>
  </div>;
}

export function ConditionChart({ observations, domain, onRevealComplete, prediction, showPrediction = true }: {
  observations: FacadeObservation[]; domain: [string, string]; onRevealComplete?: () => void;
  prediction?: ConditionPrediction | null; showPrediction?: boolean;
}) {
  const chart = useRef<SVGSVGElement>(null);
  const maskPrefix = useId();
  const [visible, setVisible] = useState(false);
  const hasRatings = observations.some((p) => p.rating);
  const forecast = chartPrediction(prediction);
  const hasVisual = hasRatings || forecast !== null;
  const range: [number, number] = forecast ? [70, 206] : [88, 306];
  const nodes = conditionChartData(observations, domain, range);
  const signature = JSON.stringify([nodes, forecast?.probability, showPrediction]);
  const historyMs = conditionRevealDuration(nodes);
  const fallbackMs = historyMs + (forecast && showPrediction ? CONDITION_FORECAST_DELAY_MS + CONDITION_FORECAST_MS : 0);
  useEffect(() => {
    const svg = chart.current;
    if (!svg) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    // Don't spend the reveal while this chart is below the panel's scroll viewport.
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.intersectionRatio >= 0.6), {
      root: svg.closest('.building-panel__body'), threshold: [0, 0.6],
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [hasVisual]);
  useEffect(() => {
    if (!onRevealComplete || (hasVisual && !visible)) return;
    let cancel: (() => void) | undefined;
    // Flush the committed CSS so getAnimations includes every delayed dot and line mask.
    const frame = requestAnimationFrame(() => {
      if (chart.current) cancel = afterChartReveal(chart.current, fallbackMs, onRevealComplete);
      else onRevealComplete(); // No rated observations: don't strand the tour.
    });
    return () => { cancelAnimationFrame(frame); cancel?.(); };
  }, [visible, hasVisual, signature, fallbackMs, onRevealComplete]);
  if (!hasVisual) return <p className="muted small">No comparable façade ratings to chart yet.</p>;
  const gaps = observations.filter((p) => !p.rating).length;
  const span = domain[0] !== domain[1];
  return <figure className="replay-chart condition-chart" style={{ '--condition-animation-state': visible ? 'running' : 'paused' } as CSSProperties}>
    <figcaption>{forecast ? 'Recorded history → model prediction' : 'Recorded façade condition over time'}</figcaption>
    <svg ref={chart} viewBox={forecast ? '0 0 360 196' : '0 0 328 146'} role="img"
      aria-label={`${observations.map((p) => `${p.date}: ${p.rating ?? 'unknown or conflicting'}`).join('; ')}${forecast && showPrediction ? `; ${forecast.isMock ? 'Synthetic' : 'Loaded'} prediction: ${forecast.percent}% chance of an UNSAFE rating in the next Initial FISP filing. Not a recorded rating or collapse probability.` : ''}`}>
      {forecast && <text x="2" y="18" fill="var(--label-2)" fontSize="12" fontWeight="600">Recorded</text>}
      <g transform={forecast ? 'translate(0 32)' : undefined}>
      {hasRatings ? FACADE_RATINGS.map((rating) => <g key={rating}>
        <rect x={range[0] - 8} y={conditionY(rating) - 15} width={range[1] - range[0] + 16} height="30" rx="8" fill={conditionColor(rating)} fillOpacity="0.09" />
        <line x1={range[0]} x2={range[1]} y1={conditionY(rating)} y2={conditionY(rating)} stroke="var(--separator-strong)" />
        <text x="2" y={conditionY(rating) + 4} fill={conditionColor(rating)} fontSize={forecast ? '11' : '12'} fontWeight="600">{rating}</text></g>)
        : <text x="2" y="60" fill="var(--label-2)" fontSize="12">No rated filings to plot</text>}
      {nodes.map((p, i) => {
        const maskId = `${maskPrefix}-line-${i}`;
        return <g key={p.date}>
          {p.from && <>
            <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="328" height="146">
              <line className="condition-chart__reveal" x1={p.from.x} y1={p.from.y} x2={p.x} y2={p.y}
                stroke="white" strokeWidth="6" pathLength="1" strokeDasharray="1"
                style={{ animationDelay: `${p.delay + CONDITION_DOT_MS}ms`, animationDuration: `${CONDITION_LINE_MS}ms` }} />
            </mask></defs>
            <line className="condition-chart__line" x1={p.from.x} y1={p.from.y} x2={p.x} y2={p.y}
              stroke="var(--label-3)" strokeWidth="2" strokeDasharray={p.bridgesGap ? '5 4' : undefined}
              mask={`url(#${maskId})`} data-gap={p.bridgesGap || undefined} />
          </>}
          <circle className="condition-chart__dot" cx={p.x} cy={p.y} r="6" fill={conditionColor(p.rating)} stroke="white" strokeWidth="2"
            style={{ animationDelay: `${p.delay}ms`, animationDuration: `${CONDITION_DOT_MS}ms` }}><title>{`${p.date}: ${p.rating}`}</title></circle>
        </g>;
      })}
      {hasRatings && <text x={span ? range[0] : (range[0] + range[1]) / 2} y="137" textAnchor={span ? 'start' : 'middle'} fill="currentColor" fontSize={forecast ? '10' : '12'}>{domain[0]}</text>}
      {hasRatings && span && <text x={range[1]} y="137" textAnchor="end" fill="currentColor" fontSize={forecast ? '10' : '12'}>{domain[1]}</text>}
      </g>
      {forecast && <>
        <line x1="219" x2="219" y1="4" y2="188" stroke="var(--separator-strong)" strokeDasharray="3 4" />
        <rect x="226" y="0" width="134" height="194" rx="12" fill={forecast.color} fillOpacity="0.09" />
        <text x="238" y="23" fill="var(--label)" fontSize="12" fontWeight="600">{forecast.isMock ? 'Synthetic' : 'Predicted'}</text>
        <text x="238" y="42" fill="var(--label-2)" fontSize="11">Next filing</text>
        {showPrediction ? <g className="condition-chart__forecast"
          style={{ animationDelay: `${historyMs + CONDITION_FORECAST_DELAY_MS}ms`, animationDuration: `${CONDITION_FORECAST_MS}ms` }}>
          <text x="238" y="86" fill={forecast.color} fontSize="38" fontWeight="600" letterSpacing="-1">{forecast.percent}%</text>
          <text x="238" y="108" fill="var(--label-2)" fontSize="11">chance of an</text>
          <text x="238" y="124" fill="var(--label)" fontSize="11" fontWeight="600">UNSAFE rating</text>
          <line x1="240" x2="346" y1="146" y2="146" stroke="var(--separator-strong)" strokeWidth="5" strokeLinecap="round" />
          <line x1="240" x2={240 + 106 * forecast.probability} y1="146" y2="146" stroke={forecast.color} strokeWidth="5" strokeLinecap="round" />
          <path className="condition-chart__prediction-marker" d="M 0 -5 L 5 0 L 0 5 L -5 0 Z"
            transform={`translate(${240 + 106 * forecast.probability} 146)`} fill={forecast.color} stroke="white" strokeWidth="1.5">
            <title>{`${(forecast.probability * 100).toFixed(2)}% predicted probability`}</title>
          </path>
          <text x="238" y="165" fill="var(--label-2)" fontSize="10">0%</text>
          <text x="348" y="165" textAnchor="end" fill="var(--label-2)" fontSize="10">100%</text>
          <text x="238" y="184" fill="var(--label-2)" fontSize="10">Not an inspection</text>
        </g> : <text x="238" y="85" fill="var(--label-2)" fontSize="11">
          <tspan x="238">Replay to the end</tspan><tspan x="238" dy="17">to see the model</tspan><tspan x="238" dy="17">prediction.</tspan>
        </text>}
      </>}
    </svg>
    {forecast && showPrediction && <p className="condition-chart__prediction-source">
      {forecast.isMock ? 'Synthetic prediction' : 'Loaded model prediction'} · {forecast.generatedAt ? `generated ${forecast.generatedAt}` : 'generation date unavailable'}.
      {' '}For the next Initial FISP filing—not collapse or a condition observed today.
    </p>}
    <p className="muted small">Up = more concern in the filing. Down = less. SWARMP = Safe With a Repair and Maintenance Program. Lines link recorded ratings, not continuous measurements.</p>
    {gaps > 0 && <p className="condition-chart__gap-note">{gaps} {gaps === 1 ? 'filing has' : 'filings have'} no comparable rating. Dashed lines bridge unrated or conflicting filings; condition within those gaps is unknown.</p>}
  </figure>;
}

function DisplacementPreview({ points }: { points: MovementPoint[] }) {
  const start = Date.parse(points[0].date), end = Date.parse(points.at(-1)!.date);
  const low = Math.min(0, ...points.map((p) => p.displacement_mm));
  const high = Math.max(0, ...points.map((p) => p.displacement_mm));
  const x = (p: MovementPoint) => 42 + (Date.parse(p.date) - start) / (end - start || 1) * 264;
  const y = (v: number) => 20 + (high - v) / (high - low || 1) * 90;
  return <figure className="replay-chart">
    <figcaption>Satellite displacement · mm along line of sight</figcaption>
    <svg viewBox="0 0 320 140" role="img" aria-label={`Satellite displacement from ${points[0].date} to ${points.at(-1)!.date}`}>
      <line x1="42" x2="306" y1={y(0)} y2={y(0)} stroke="var(--separator-strong)" />
      <text x="2" y="24" fontSize="12" fill="currentColor">{high.toFixed(1)}</text>
      <text x="2" y="110" fontSize="12" fill="currentColor">{low.toFixed(1)}</text>
      <path d={points.map((p, i) => `${i ? 'L' : 'M'}${x(p)},${y(p.displacement_mm)}`).join(' ')} fill="none" stroke="var(--tint)" strokeWidth="2.5" />
      <text x="42" y="134" fontSize="11" fill="currentColor">{points[0].date}</text>
      <text x="306" y="134" fontSize="11" fill="currentColor" textAnchor="end">{points.at(-1)!.date}</text>
    </svg>
    <p className="muted small">Line joins available observations; gaps are not additional measurements.</p>
  </figure>;
}
