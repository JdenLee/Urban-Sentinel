import { useMemo, useState } from 'react';
import type { JoinedFeature } from '../types/predictions';
import { PRIORITY_COLOR, rgbCss } from '../data/priority';
import { ASSIGNMENT_LABEL, downloadText, searchScored, shortlistCsv, type AssignmentStatus } from '../data/shortlist';

export interface ShortlistProps {
  scored: JoinedFeature[];
  capacity: number;
  shortlistOnly: boolean;
  selectedBin: string | null;
  status: (bin: string) => AssignmentStatus;
  onCapacity: (n: number) => void;
  onShortlistOnly: (v: boolean) => void;
  onSelect: (bin: string) => void;
}

const CAPACITY_MAX = 100;

export function SearchBox({ scored, onSelect }: { scored: JoinedFeature[]; onSelect: (bin: string) => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchScored(scored, q), [scored, q]);
  const choose = (bin: string) => {
    onSelect(bin);
    setQ('');
  };
  return (
    <div className="search" role="search">
      <input
        type="search"
        className="search__input"
        placeholder="Search address or BIN"
        aria-label="Search scored buildings by address or BIN"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && results[active]) choose(results[active].properties.bin);
          else if (e.key === 'Escape') {
            e.stopPropagation();
            setQ('');
          }
        }}
      />
      {q.trim() && (
        <ul className="search__results" role="listbox">
          {results.length === 0 && <li className="search__empty">No scored building matches.</li>}
          {results.map((f, i) => {
            const p = f.properties.prediction!;
            return (
              <li key={f.properties.bin} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={`search__item${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(f.properties.bin)}
                >
                  <span className="swatch swatch--sm" style={{ background: rgbCss(PRIORITY_COLOR[p.priority]) }} />
                  <span className="search__addr">{f.properties.address ?? 'Address unavailable'}</span>
                  <span className="search__bin mono">{f.properties.bin}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Shortlist(props: ShortlistProps) {
  const { scored, capacity, shortlistOnly, selectedBin, status, onCapacity, onShortlistOnly, onSelect } = props;
  const rows = scored.slice(0, capacity);
  const assigned = rows.filter((f) => status(f.properties.bin) !== 'unassigned').length;

  return (
    <div className="shortlist">
      <div className="legend__head">
        <h3 className="section-title">Inspection shortlist</h3>
        <span className="legend__unit">
          {assigned}/{rows.length} actioned
        </span>
      </div>
      <label className="capacity">
        <span className="capacity__label">
          Capacity <strong className="mono">{capacity}</strong> inspections
        </span>
        <input
          type="range"
          min={5}
          max={Math.min(CAPACITY_MAX, scored.length)}
          step={5}
          value={capacity}
          onChange={(e) => onCapacity(Number(e.target.value))}
          aria-label="Inspection capacity"
        />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={shortlistOnly} onChange={(e) => onShortlistOnly(e.target.checked)} />
        Colour only the shortlist on the map
      </label>
      <ol className="toplist">
        {rows.map((f) => {
          const p = f.properties.prediction!;
          const st = status(f.properties.bin);
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
                {st !== 'unassigned' ? (
                  <span className={`status-tag status-tag--${st}`}>{ASSIGNMENT_LABEL[st]}</span>
                ) : (
                  <span className="toplist__score mono">{p.score.toFixed(2)}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="btn btn--block"
        onClick={() => downloadText(`inspection-shortlist-top${rows.length}.csv`, shortlistCsv(rows, status))}
      >
        Export shortlist (CSV)
      </button>
    </div>
  );
}
