import { useEffect, useMemo, useState } from 'react';
import type { Geometry } from 'geojson';
import { fetchBuildingFacts, type BuildingFacts } from '../data/buildingFacts';
import { aerialView, fetchCommonsPhoto, geometryCenter, streetViewUrl, type CommonsPhoto } from '../data/buildingImagery';
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
  const hasPhoto = photo.status === 'ready';
  const [view, setView] = useState<'photo' | 'aerial'>('photo');
  const showing = hasPhoto && (view === 'photo' || !aerial) ? 'photo' : aerial ? 'aerial' : null;

  return (
    <section className="profile" aria-label="About this building">
      {(showing || photo.status === 'loading') && (
        <figure className="profile__media">
          {showing === 'photo' && hasPhoto && <LandmarkPhoto photo={photo.photo} alt={`${landmark?.name ?? 'Building'} photo`} />}
          {showing === 'aerial' && aerial && <AerialPhoto key={aerial.url} view={aerial} />}
          {!showing && <div className="profile__frame profile__frame--loading" aria-hidden />}
          {hasPhoto && aerial && (
            <div className="profile__switch" role="group" aria-label="Image">
              {(['photo', 'aerial'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={showing === v} className={showing === v ? 'is-on' : ''} onClick={() => setView(v)}>
                  {v === 'photo' ? 'Photo' : 'Aerial'}
                </button>
              ))}
            </div>
          )}
          <figcaption className="profile__credit">
            {showing === 'photo' && hasPhoto ? (
              <a href={photo.photo.page} target="_blank" rel="noopener noreferrer" title="Photo, author and licence on Wikimedia Commons">
                Photo: {photo.photo.artist ?? 'Wikimedia Commons'}
                {photo.photo.license ? ` · ${photo.photo.license}` : ''} ↗
              </a>
            ) : (
              <span title="New York State statewide orthoimagery, 2022–2025. The outline is the building's footprint at ground level; tall buildings lean in aerial photos.">
                Aerial 2022–25 · NYS ITS Geospatial Services
              </span>
            )}
            {street && (
              <a className="profile__street" href={street} target="_blank" rel="noopener noreferrer">
                Street View ↗
              </a>
            )}
          </figcaption>
        </figure>
      )}
      <Facts state={facts} knownFloors={knownFloors ?? null} />
    </section>
  );
}

function LandmarkPhoto({ photo, alt }: { photo: CommonsPhoto; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={`profile__frame profile__frame--photo${loaded ? '' : ' profile__frame--loading'}`}>
      <img src={photo.src} alt={alt} decoding="async" onLoad={() => setLoaded(true)} />
    </div>
  );
}

function AerialPhoto({ view }: { view: NonNullable<ReturnType<typeof aerialView>> }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  if (state === 'failed') return <div className="profile__frame profile__frame--empty">Aerial photo unavailable right now</div>;
  return (
    <div className={`profile__frame${state === 'loading' ? ' profile__frame--loading' : ''}`}>
      <img
        src={view.url}
        alt="Aerial photo of the building with its footprint outlined"
        decoding="async"
        onLoad={() => setState('ready')}
        onError={() => setState('failed')}
      />
      {state === 'ready' && (
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
