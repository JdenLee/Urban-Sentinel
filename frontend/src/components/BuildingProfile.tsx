import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Geometry } from 'geojson';
import { fetchBuildingFacts, type BuildingFacts } from '../data/buildingFacts';
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
}

/** Aerial photo with the footprint outline, or the landmark's photo, plus the building's facts. */
export function BuildingProfile({ bin, geometry, heightM, landmark, knownFloors }: BuildingProfileProps) {
  const facts = useBuildingFacts(bin);
  const photo = useLandmarkPhoto(landmark?.photo);
  const aerial = useMemo(() => aerialView(geometry, heightM), [geometry, heightM]);
  const center = useMemo(() => geometryCenter(geometry), [geometry]);
  const street = center ? streetViewUrl(center[0], center[1]) : null;
  const streetImage = center ? streetViewImageUrl(center[0], center[1], heightM, GOOGLE_MAPS_KEY) : null;
  const [failed, setFailed] = useState<ReadonlySet<SlideId>>(new Set());
  const fail = useCallback((id: SlideId) => setFailed((prev) => new Set(prev).add(id)), []);

  // Street level first: it is how a building is recognised. Landmarks lead with their curated photo.
  const slides: Slide[] = [];
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
  if (streetImage) {
    slides.push({
      id: 'street',
      label: 'Street View',
      body: <PhotoSlide src={streetImage} alt="Street View of the building" street onFail={() => fail('street')} />,
      credit: <span title="Google Street View, nearest panorama, facing the building">Street View · © Google</span>,
    });
  }
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
  const visible = slides.filter((sl) => !failed.has(sl.id));

  return (
    <section className="profile" aria-label="About this building">
      {visible.length > 0 ? (
        <Carousel slides={visible} street={street} />
      ) : (
        photo.status === 'loading' && <div className="profile__frame profile__frame--loading" aria-hidden />
      )}
      <Facts state={facts} knownFloors={knownFloors ?? null} />
    </section>
  );
}

type SlideId = 'photo' | 'street' | 'aerial';
interface Slide {
  id: SlideId;
  label: string;
  body: ReactNode;
  credit: ReactNode;
}

/**
 * Horizontal scroll-snap strip: swipe, trackpad, arrow keys, the chevrons or the dots all move it,
 * and the index is read back from the scroll position so every input agrees.
 */
function Carousel({ slides, street }: { slides: Slide[]; street: string | null }) {
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const current = Math.min(index, slides.length - 1);
  const many = slides.length > 1;

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

  // A slide that fails to load is removed; keep the strip aligned to the slide still being shown.
  useEffect(() => {
    if (index > slides.length - 1) go(slides.length - 1);
  }, [index, slides.length, go]);

  return (
    <figure className="profile__media">
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
    </figure>
  );
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
  const units = f ? (f.unitsResidential && f.unitsResidential > 0 ? f.unitsResidential : f.unitsTotal) : null;
  const unitLabel = f && f.unitsResidential && f.unitsResidential > 0 ? 'Homes' : 'Units';

  return (
    <div className="profile__facts">
      <dl className="profile__stats">
        <Stat label={multi ? 'Floors (tallest)' : 'Floors'} value={floors ? int.format(floors) : null} />
        <Stat label={multi ? `${unitLabel} on lot` : unitLabel} value={units !== null && units > 0 ? int.format(units) : f ? '0' : null} />
        <Stat label={multi ? 'Floor area, lot' : 'Floor area'} value={f?.buildingAreaSqft ? `${compact.format(f.buildingAreaSqft)} ft²` : null} />
      </dl>

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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="kv__row">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
    </div>
  );
}
