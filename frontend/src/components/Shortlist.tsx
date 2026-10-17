import { useEffect, useMemo, useState } from 'react';
import type { JoinedFeature, LookupTarget } from '../types/predictions';
import { PRIORITY_COLOR, rgbCss } from '../data/priority';
import {
  ASSIGNMENT_LABEL,
  combineSearchResults,
  downloadText,
  searchScored,
  shortlistCsv,
  type AssignmentStatus,
  type SearchItem,
} from '../data/shortlist';
import { searchAddresses, type AddressMatch } from '../data/geosearch';

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

const ADDRESS_MIN_CHARS = 3;
const ADDRESS_DEBOUNCE_MS = 250;

type AddressSearch = { status: 'idle' | 'loading' | 'error'; results: AddressMatch[] };

/** Debounced, abortable NYC address suggestions (GeoSearch); skipped for empty or digits-only queries. */
function useAddressSearch(query: string): AddressSearch {
  const [state, setState] = useState<AddressSearch>({ status: 'idle', results: [] });
  useEffect(() => {
    const q = query.trim();
    if (q.length < ADDRESS_MIN_CHARS || /^\d+$/.test(q)) {
      setState({ status: 'idle', results: [] });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ status: 'loading', results: s.results }));
    const timer = window.setTimeout(() => {
      searchAddresses(q, ctrl.signal)
        .then((results) => setState({ status: 'idle', results }))
        .catch(() => {
          if (!ctrl.signal.aborted) setState({ status: 'error', results: [] });
        });
    }, ADDRESS_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);
  return state;
}

export interface SearchBoxProps {
  scored: JoinedFeature[];
  /** A scored building already in the scene. */
  onSelect: (bin: string) => void;
  /** Any other NYC building, from an address suggestion or a typed BIN. */
  onLookup: (target: LookupTarget) => void;
}

export function SearchBox({ scored, onSelect, onLookup }: SearchBoxProps) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const local = useMemo(() => searchScored(scored, q, 5), [scored, q]);
  const addresses = useAddressSearch(q);
  const results = useMemo(() => combineSearchResults(local, addresses.results, q), [local, addresses.results, q]);
  const choose = (item: SearchItem) => {
    if (item.kind === 'scored') onSelect(item.bin);
    else if (item.kind === 'address') onLookup({ bin: item.bin, label: item.label, lonLat: item.match.lonLat });
    else onLookup({ bin: item.bin, label: null, lonLat: null });
    setQ('');
  };
  const empty =
    addresses.status === 'loading'
      ? 'Searching NYC addresses…'
      : addresses.status === 'error'
        ? 'Address search unavailable; try a BIN.'
        : 'No match. Try a street address or a 7-digit BIN.';
  return (
    <div className="search" role="search">
      <input
        type="search"
        className="search__input"
        placeholder="Search any NYC address or BIN"
        aria-label="Search buildings by address or BIN"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && results[active]) choose(results[active]);
          else if (e.key === 'Escape') {
            e.stopPropagation();
            setQ('');
          }
        }}
      />
      {q.trim() && (
        <ul className="search__results" role="listbox">
          {results.length === 0 && <li className="search__empty">{empty}</li>}
          {results.map((item, i) => (
            <li key={`${item.kind}-${item.bin}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`search__item${i === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
              >
                {item.kind === 'scored' ? (
                  <span
                    className="swatch swatch--sm"
                    style={{ background: rgbCss(PRIORITY_COLOR[item.feature.properties.prediction!.priority]) }}
                  />
                ) : (
                  <span className="swatch swatch--sm swatch--hollow" aria-hidden />
                )}
                <span className="search__addr">{item.label}</span>
                <span className="search__bin mono">{item.kind === 'bin' ? '' : item.bin}</span>
              </button>
            </li>
          ))}
          {results.length > 0 && addresses.status === 'loading' && (
            <li className="search__empty">Searching NYC addresses…</li>
          )}
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
