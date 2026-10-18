import { useEffect, useMemo, useState } from 'react';
import type { MovementPoint, RecordEvent } from '../types/predictions';
import { historyAt, historyCounts, historyDates, recordDate } from '../data/historyReplay';

export function HistoryReplay({ records, points, isMock, source }: {
  records: RecordEvent[]; points: MovementPoint[]; isMock: boolean; source: string | null;
}) {
  const dates = useMemo(() => historyDates(records, points), [records, points]);
  const counts = useMemo(() => historyCounts(records, dates), [records, dates]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => { setIndex(dates.length - 1); setPlaying(false); }, [dates]);
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
  const date = dates[Math.max(0, Math.min(index, dates.length - 1))];
  if (!date) return <p className="notice">No dated observations available to replay. Connect the history service to load municipal records.</p>;
  const at = historyAt(records, points, date);
  const undated = records.filter((r) => !recordDate(r.date)).length;
  const latest = at.records[0];
  const movement = at.points.at(-1);
  const max = Math.max(1, ...counts);
  const x = (i: number) => 12 + i / Math.max(1, dates.length - 1) * 296;
  const path = counts.slice(0, index + 1).map((count, i) => `${i ? 'L' : 'M'}${x(i)},${84 - count / max * 64}`).join(' ');
  return <section className="history-replay" aria-label="Historical record playback">
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
    <input type="range" min={0} max={Math.max(0, dates.length - 1)} value={Math.max(0, index)}
      aria-label="Historical observation date" aria-valuetext={date}
      onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} />
    <div className="replay-endpoints"><span>{dates[0]}</span><span>{dates.at(-1)}</span></div>
    <div className="history-stats">
      <div><strong>{at.records.length}</strong><span>records by this date</span></div>
      <div><strong>{movement ? movement.displacement_mm.toFixed(1) : '—'}<small> mm</small></strong>
        <span>{movement ? `LOS displacement · ${movement.date}` : 'No satellite observation yet'}</span></div>
    </div>
    <figure className="replay-chart">
      <figcaption>Records accumulated over observed dates</figcaption>
      <svg viewBox="0 0 320 100" role="img" aria-label={`${at.records.length} dated records by ${date}; ${records.length - undated} total dated records`}>
        <path d={path} fill="none" stroke="var(--label-3)" strokeWidth="2" />
        <line x1={x(index)} x2={x(index)} y1="12" y2="88" stroke="var(--tint)" strokeDasharray="3 3" />
        <circle cx={x(index)} cy={84 - at.records.length / max * 64} r="5" fill="var(--tint)" />
        <text x="12" y="12" fill="currentColor" fontSize="12">{max} records</text>
      </svg>
    </figure>
    {at.points.length > 1 && <DisplacementPreview points={at.points} />}
    <p className="muted small">Each step is an observed date, not equal elapsed time. {undated > 0 ? `${undated} undated records excluded. ` : ''}
      Present-day building shapes and predictions stay unchanged. This is a records replay, not a structural simulation.</p>
    {points.length > 0 && <p className="muted small">{isMock ? 'Synthetic satellite values.' : `Satellite source: ${source ?? 'see source metadata'}. Line-of-sight displacement, not building deformation.`}</p>}
  </section>;
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
