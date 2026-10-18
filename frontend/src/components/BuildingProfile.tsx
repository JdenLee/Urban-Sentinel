import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Geometry } from 'geojson';
import { buildingUse, fetchBuildingFacts, type BuildingFacts, type BuildingUse } from '../data/buildingFacts';
import { aerialView, fetchCommonsPhoto, geometryCenter, streetViewImageUrl, streetViewUrl, type CommonsPhoto } from '../data/buildingImagery';
import { GOOGLE_MAPS_KEY } from '../config';
import type { Landmark } from '../data/landmarks';

const PLUTO_PAGE = 'https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks';

type FactsState = { status: 'loading' } | { status: 'ready'; facts: BuildingFacts | null } | { status: 'error' };
type PhotoState = { status: 'loading' | 'none' } | { status: 'ready'; photo: CommonsPhoto };

const int = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function useBuildingFacts(bin: string): FactsState {
  const [state, setState] = useState<FactsState>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    fetchBuildingFacts(bin).then(
      (facts) => live && setState({ status: 'ready', facts }),
      () => live && setState({ status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [bin]);
  return state;
}

function useLandmarkPhoto(file: string | undefined): PhotoState {
  const [state, setState] = useState<PhotoState>({ status: file ? 'loading' : 'none' });
  useEffect(() => {
    if (!file) {
      setState({ status: 'none' });
      return;
    }
    let live = true;
    setState({ status: 'loading' });
    fetchCommonsPhoto(file).then(
      (photo) => live && setState(photo ? { status: 'ready', photo } : { status: 'none' }),
      () => live && setState({ status: 'none' }),
    );
    return () => {
      live = false;
    };
  }, [file]);
  return state;
}

/** ZoLa (NYC Planning's lot viewer) for a BBL: zoning, lot lines and more about the parcel. */
function zolaUrl(bbl: string): string {
  return `https://zola.planning.nyc.gov/l/lot/${bbl[0]}/${Number(bbl.slice(1, 6))}/${Number(bbl.slice(6))}`;
}

export interface BuildingProfileProps {
  bin: string;
  geometry: Geometry | null;
  /** Roof height in metres; widens the aerial crop so a leaning tower's roof stays in frame. */
  heightM: number;
  landmark?: Landmark;
  /** Floors already known from the scene's footprint data, shown while the live facts load. */
  knownFloors?: number | null;
  demoImage?: 'aerial' | 'street';
}

/** Aerial photo with the footprint outline, or the landmark's photo, plus the building's facts. */
export function BuildingProfile({ bin, geometry, heightM, landmark, knownFloors, demoImage }: BuildingProfileProps) {
  const facts = useBuildingFacts(bin);
  const photo = useLandmarkPhoto(landmark?.photo);
  const aerial = useMemo(() => aerialView(geometry, heightM), [geometry, heightM]);
  const center = useMemo(() => geometryCenter(geometry), [geometry]);
  const street = center ? streetViewUrl(center[0], center[1]) : null;
  const streetImage = center ? streetViewImageUrl(center[0], center[1], heightM, GOOGLE_MAPS_KEY) : null;
  const [failed, setFailed] = useState<ReadonlySet<SlideId>>(new Set());
  useEffect(() => setFailed(new Set()), [bin]);
  const fail = useCallback((id: SlideId) => setFailed((prev) => new Set(prev).add(id)), []);

  // Fixed order: aerial (always available, exact footprint), then Street View, then a landmark's photo.
  const slides: Slide[] = [];
  if (aerial) {
    slides.push({
      id: 'aerial',
      label: 'Aerial',
      body: <AerialSlide view={aerial} onFail={() => fail('aerial')} />,
      credit: (
        <span title="New York State statewide orthoimagery, 2022–2025. The outline is the building's footprint at ground level; tall buildings lean in aerial photos.">
          Aerial 2022–25 · NYS ITS Geospatial Services
        </span>
      ),
    });
  }
  if (streetImage) {
    slides.push({
      id: 'street',
      label: 'Street View',
      body: <PhotoSlide src={streetImage} alt="Street View of the building" street onFail={() => fail('street')} />,
      credit: <span title="Google Street View, nearest panorama, facing the building">Street View · © Google</span>,
    });
  } else if (street) {
    slides.push({ id: 'street', label: 'Street View', expandable: false, body: <StreetLink url={street} />,
      credit: <span>Google Street View · opens in Google Maps</span> });
  }
  if (photo.status === 'ready') {
    const p = photo.photo;
    slides.push({
      id: 'photo',
      label: 'Photo',
      body: <PhotoSlide src={p.src} alt={`${landmark?.name ?? 'Building'} photo`} onFail={() => fail('photo')} />,
      credit: (
        <a href={p.page} target="_blank" rel="noopener noreferrer" title="Photo, author and licence on Wikimedia Commons">
          Photo: {p.artist ?? 'Wikimedia Commons'}
          {p.license ? ` · ${p.license}` : ''} ↗
        </a>
      ),
    });
  }
  const visible = slides.filter((sl) => !failed.has(sl.id) || (sl.id === 'street' && street)).map((sl) =>
    sl.id === 'street' && failed.has(sl.id) && street ? { ...sl, expandable: false, body: <StreetLink url={street} unavailable />,
      credit: <span>Street View image unavailable · open Google Maps</span> } : sl);

  return (
    <section className="profile" aria-label="About this building">
      {visible.length > 0 ? (
        <Carousel slides={visible} street={street} demoImage={demoImage} />
      ) : (
        <div className="profile__frame profile__frame--empty">{photo.status === 'loading' ? 'Loading building images…' : 'Building imagery is unavailable right now.'}</div>
      )}
      {!visible.length && street && <a className="profile__street" href={street} target="_blank" rel="noopener noreferrer">Open Street View ↗</a>}
      <Facts state={facts} knownFloors={knownFloors ?? null} />
    </section>
  );
}

type SlideId = 'photo' | 'street' | 'aerial';
interface Slide {
  expandable?: boolean;
  id: SlideId;
  label: string;
  body: ReactNode;
  credit: ReactNode;
}

/**
 * Horizontal scroll-snap strip: swipe, trackpad, arrow keys, the chevrons or the dots all move it,
 * and the index is read back from the scroll position so every input agrees.
 */
function Carousel({ slides, street, demoImage }: { slides: Slide[]; street: string | null; demoImage?: 'aerial' | 'street' }) {
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = Math.min(index, slides.length - 1);
  const many = slides.length > 1;
  useEffect(() => {
    if (expanded) dialog.current?.showModal();
    else dialog.current?.close();
  }, [expanded]);

  const go = useCallback(
    (i: number) => {
      const el = strip.current;
      if (!el) return;
      const target = Math.max(0, Math.min(slides.length - 1, i));
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ left: target * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
    },
    [slides.length],
  );
  const slideIds = slides.map((s) => s.id).join(',');
  useEffect(() => {
    // Hidden off-screen slide links should not be keyboard or screen-reader stops.
    Array.from(strip.current?.children ?? []).forEach((child, i) => {
      (child as HTMLElement).inert = i !== current;
    });
  }, [current, slideIds]);
  useEffect(() => {
    if (!demoImage) return;
    const target = slideIds.split(',').indexOf(demoImage);
    if (target >= 0) go(target);
  }, [demoImage, slideIds, go]);

  // A slide that fails to load is removed; keep the strip aligned to the slide still being shown.
  useEffect(() => {
    if (index > slides.length - 1) go(slides.length - 1);
  }, [index, slides.length, go]);

  return (
    <figure className="profile__media" data-demo="photos">
      <div
        className="carousel"
        role="region"
        aria-roledescription="carousel"
        aria-label="Building images"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(current + 1);
          else if (e.key === 'ArrowLeft') go(current - 1);
          else return;
          e.preventDefault();
        }}
      >
        <div
          ref={strip}
          className="carousel__strip"
          onScroll={(e) => {
            const el = e.currentTarget;
            setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
          }}
        >
          {slides.map((sl, i) => (
            <div key={sl.id} className="carousel__slide" role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}: ${sl.label}`}>
              {sl.body}
              {sl.expandable !== false && <button type="button" className="carousel__expand" tabIndex={i === current ? 0 : -1} aria-label={`Enlarge ${sl.label.toLowerCase()} image`} onClick={() => setExpanded(true)}><span aria-hidden>↗</span></button>}
            </div>
          ))}
        </div>
        <span className="carousel__tag">{slides[current]?.label}</span>
        {many && (
          <>
            <button type="button" className="carousel__nav carousel__nav--prev" aria-label="Previous image" disabled={current === 0} onClick={() => go(current - 1)}>
              ‹
            </button>
            <button type="button" className="carousel__nav carousel__nav--next" aria-label="Next image" disabled={current === slides.length - 1} onClick={() => go(current + 1)}>
              ›
            </button>
            <div className="carousel__dots">
              {slides.map((sl, i) => (
                <button key={sl.id} type="button" aria-label={`Show ${sl.label}`} aria-current={i === current} className={i === current ? 'is-on' : ''} onClick={() => go(i)} />
              ))}
            </div>
          </>
        )}
      </div>
      <figcaption className="profile__credit">
        {slides[current]?.credit}
        {street && (
          <a className="profile__street" href={street} target="_blank" rel="noopener noreferrer">
            Open Street View ↗
          </a>
        )}
      </figcaption>
      <dialog ref={dialog} className="image-viewer" aria-label="Enlarged building images"
        onCancel={() => setExpanded(false)} onClose={() => setExpanded(false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'ArrowRight') { e.preventDefault(); go(current + 1); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); go(current - 1); }
        }} onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}>
        <header><h3>{slides[current]?.label} · Building image</h3><button type="button" className="icon-btn" aria-label="Close image viewer" onClick={() => setExpanded(false)}>×</button></header>
        {expanded && slides[current]?.body}
        <div className="image-viewer__controls">
          <button type="button" className="btn" disabled={current === 0} onClick={() => go(current - 1)}>← Previous</button>
          <span>{current + 1} / {slides.length}</span>
          <button type="button" className="btn" disabled={current === slides.length - 1} onClick={() => go(current + 1)}>Next →</button>
        </div>
        <div className="profile__credit">{slides[current]?.credit}{street && <a href={street} target="_blank" rel="noopener noreferrer">Open Street View ↗</a>}</div>
      </dialog>
    </figure>
  );
}

function StreetLink({ url, unavailable = false }: { url: string; unavailable?: boolean }) {
  return <div className="profile__frame profile__street-fallback">
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M3 21V8l6-3v16m0-19h7v19m0-12h5v12M1 21h22M12 5v2m0 3v2m0 3v2M5 10v2m0 3v2m13-5v2m0 3v2" /></svg>
    <strong>See it from the street</strong>
    <span>{unavailable ? 'The embedded panorama could not load.' : 'Embedded imagery needs a configured Google Maps key.'}</span>
    <a href={url} target="_blank" rel="noopener noreferrer">Open Google Street View ↗</a>
  </div>;
}

function PhotoSlide({ src, alt, street, onFail }: { src: string; alt: string; street?: boolean; onFail: () => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={`profile__frame${street ? '' : ' profile__frame--photo'}${loaded ? '' : ' profile__frame--loading'}`}>
      <img src={src} alt={alt} decoding="async" draggable={false} onLoad={() => setLoaded(true)} onError={onFail} />
    </div>
  );
}

function AerialSlide({ view, onFail }: { view: NonNullable<ReturnType<typeof aerialView>>; onFail: () => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={`profile__frame${loaded ? '' : ' profile__frame--loading'}`}>
      <img
        src={view.url}
        alt="Aerial photo of the building with its footprint outlined"
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={onFail}
      />
      {loaded && (
        <svg viewBox={`0 0 ${view.width} ${view.height}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
          <path d={view.outline} fillRule="evenodd" />
        </svg>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="profile__stat">
      <dt>{label}</dt>
      <dd className="mono">{value ?? '—'}</dd>
    </div>
  );
}

function Facts({ state, knownFloors }: { state: FactsState; knownFloors: number | null }) {
  const f = state.status === 'ready' ? state.facts : null;
  const multi = (f?.buildingsOnLot ?? 1) > 1;
  const floors = f?.floors ?? knownFloors;
  const units = f?.unitsTotal ?? null;
  const use = f ? buildingUse(f) : null;

  return (
    <div className="profile__facts" data-demo="facts">
      {f && use && <div className="building-use"><UseIcon use={use} /><div><strong>{use === 'Other' ? (f.buildingClassLabel ?? f.landUse ?? 'Use not recorded') : use}</strong>
        <span>{f.buildingClassLabel ?? f.landUse ?? 'NYC MapPLUTO'}{f.buildingClass ? ` · ${f.buildingClass}` : ''}</span></div></div>}
      <dl className="profile__stats">
        <Stat label={multi ? 'Floors (tallest)' : 'Floors'} value={floors ? int.format(floors) : null} />
        <Stat label={multi ? 'Total units on lot' : 'Total units'} value={units !== null && units >= 0 ? int.format(units) : null} />
        <Stat label={multi ? 'Floor area, lot' : 'Floor area'} value={f?.buildingAreaSqft ? `${compact.format(f.buildingAreaSqft)} ft²` : null} />
      </dl>
      {f?.unitsResidential !== null && f?.unitsResidential !== undefined && f.unitsResidential > 0 && <p className="profile__note">{int.format(f.unitsResidential)} residential units{multi ? ' across the tax lot' : ''} · NYC MapPLUTO</p>}

      {state.status === 'loading' && <p className="profile__note">Loading building facts…</p>}
      {state.status === 'error' && <p className="profile__note">Building facts could not be loaded right now.</p>}
      {state.status === 'ready' && !f && <p className="profile__note">No tax-lot record found for this building.</p>}
      {f && multi && (
        <p className="profile__note">
          This tax lot holds {int.format(f.buildingsOnLot!)} buildings; unit and floor-area totals cover all of them.
        </p>
      )}

      {f && (
        <details className="profile__more">
          <summary>More building details</summary>
          <dl className="kv">
            {f.buildingClass && <Row label="Building type" value={`${f.buildingClassLabel ?? 'Class'} (${f.buildingClass})`} />}
            {f.landUse && <Row label="Land use" value={f.landUse} />}
            {f.unitsTotal !== null && f.unitsTotal !== f.unitsResidential && <Row label="Total units" value={int.format(f.unitsTotal)} />}
            {f.yearBuilt && <Row label="Year built" value={String(f.yearBuilt)} />}
            {f.yearAltered && <Row label="Last major alteration" value={String(f.yearAltered)} />}
            {f.lotAreaSqft && <Row label="Lot area" value={`${int.format(f.lotAreaSqft)} ft²`} />}
            {f.buildingsOnLot && <Row label="Buildings on lot" value={int.format(f.buildingsOnLot)} />}
            {f.ownership && <Row label="Ownership" value={f.ownership} />}
            {f.zoning && <Row label="Zoning" value={f.zoning} />}
            {f.landmark && <Row label="Landmark" value={f.landmark} />}
            {f.historicDistrict && <Row label="Historic district" value={f.historicDistrict} />}
            <Row label="Tax lot (BBL)" value={f.bbl} mono />
          </dl>
          <p className="profile__source">
            Source: <a href={PLUTO_PAGE} target="_blank" rel="noopener noreferrer">NYC MapPLUTO ↗</a> ·{' '}
            <a href={zolaUrl(f.bbl)} target="_blank" rel="noopener noreferrer">View lot on ZoLa ↗</a>
          </p>
        </details>
      )}
    </div>
  );
}

function UseIcon({ use }: { use: BuildingUse }) {
  const path = use === 'Utility' ? 'M13 2 5 13h6l-1 9 9-13h-7z'
    : use === 'Residential' || use === 'Mixed use' ? 'M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10'
    : use === 'Commercial' ? 'M5 21V3h14v18M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 21v-3h4v3'
    : use === 'Industrial' ? 'M3 21V9l6 4V9l6 4V3h4l2 18ZM7 17h1m4 0h1m4 0h1'
    : use === 'Transportation' ? 'M5 16V6q0-3 7-3t7 3v10H5ZM5 10h14M8 20l-3 2m11-2 3 2M8 14h1m6 0h1'
    : 'M3 9h18L12 3ZM5 11v8m7-8v8m7-8v8M3 21h18';
  return <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={path} /></svg>;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="kv__row">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
    </div>
  );
}
