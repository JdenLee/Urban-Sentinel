/**
 * Building facts for the record panel, read live from NYC Open Data (no key):
 *
 * 1. Building Footprints (5zhs-2jue) by BIN gives the tax lot (BBL) the building stands on.
 * 2. MapPLUTO (64uk-42ks) by BBL gives floors, units, floor area, building class, zoning and more.
 *
 * PLUTO describes the tax lot, not the individual building. On a lot with several buildings (a
 * housing development, a campus) the unit and floor-area totals cover all of them and the floor
 * count is the tallest building's, so the result carries `buildingsOnLot` for the panel to say so.
 */
import { FOOTPRINT_ATTRS_URL, PLUTO_URL } from '../config';

const BIN_RE = /^[1-5]\d{6}$/;
const BBL_RE = /^[1-5]\d{9}$/;

export interface BuildingFacts {
  bbl: string;
  address: string | null;
  floors: number | null;
  unitsResidential: number | null;
  unitsTotal: number | null;
  buildingAreaSqft: number | null;
  lotAreaSqft: number | null;
  buildingsOnLot: number | null;
  buildingClass: string | null;
  buildingClassLabel: string | null;
  landUse: string | null;
  yearBuilt: number | null;
  yearAltered: number | null;
  ownership: string | null;
  zoning: string | null;
  historicDistrict: string | null;
  landmark: string | null;
}

/** First letter of the DOF building class (full code list: NYC DOF Building Classifications). */
const CLASS_FAMILY: Record<string, string> = {
  A: 'One-family dwelling',
  B: 'Two-family dwelling',
  C: 'Walk-up apartments',
  D: 'Elevator apartments',
  E: 'Warehouse',
  F: 'Factory / industrial',
  G: 'Garage / gas station',
  H: 'Hotel',
  I: 'Hospital / health facility',
  J: 'Theatre',
  K: 'Store building',
  L: 'Loft building',
  M: 'Religious facility',
  N: 'Asylum / home',
  O: 'Office building',
  P: 'Place of assembly / cultural',
  Q: 'Outdoor recreation',
  R: 'Condominium',
  S: 'Mixed residential / commercial',
  T: 'Transportation facility',
  U: 'Utility',
  V: 'Vacant land',
  W: 'Educational facility',
  Y: 'Government facility',
  Z: 'Miscellaneous',
};

/** MapPLUTO LandUse codes. */
const LAND_USE: Record<string, string> = {
  '1': 'One & two family buildings',
  '2': 'Multi-family walk-up',
  '3': 'Multi-family elevator',
  '4': 'Mixed residential & commercial',
  '5': 'Commercial & office',
  '6': 'Industrial & manufacturing',
  '7': 'Transportation & utility',
  '8': 'Public facilities & institutions',
  '9': 'Open space & recreation',
  '10': 'Parking facilities',
  '11': 'Vacant land',
};

/** MapPLUTO OwnerType. Owner names are deliberately not shown: many are private individuals. */
const OWNERSHIP: Record<string, string> = {
  C: 'City-owned',
  M: 'Mixed city & private',
  O: 'Other public (state, federal, authority)',
  P: 'Private',
  X: 'Tax-exempt',
};

export function buildingClassLabel(code: string | null): string | null {
  if (!code) return null;
  return CLASS_FAMILY[code.charAt(0).toUpperCase()] ?? null;
}

export type BuildingUse = 'Residential' | 'Commercial' | 'Mixed use' | 'Utility' | 'Transportation' | 'Industrial' | 'Civic' | 'Other';
/** PLUTO land use resolves ambiguous condo class R; utility and transport remain distinct. */
export function buildingUse(facts: Pick<BuildingFacts, 'buildingClass' | 'landUse'>): BuildingUse {
  const family = facts.buildingClass?.[0]?.toUpperCase();
  if (family === 'U') return 'Utility';
  if (family === 'T') return 'Transportation';
  const use = facts.landUse ?? '';
  if (/Mixed residential/i.test(use) || family === 'S') return 'Mixed use';
  if (/family/i.test(use) || (family && 'ABCD'.includes(family))) return 'Residential';
  if (/Commercial/i.test(use) || (family && 'HKO'.includes(family))) return 'Commercial';
  if (/Industrial/i.test(use) || (family && 'EF'.includes(family))) return 'Industrial';
  if (/Public facilities/i.test(use) || (family && 'IMNWY'.includes(family))) return 'Civic';
  return 'Other';
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Positive counts and areas only: PLUTO writes 0 for "not recorded". */
function positive(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** BBLs come back as "1003560001" or "1003560001.00000000". */
export function normalizeBbl(v: unknown): string | null {
  const n = num(v);
  if (n === null) return null;
  const s = String(Math.trunc(n));
  return BBL_RE.test(s) ? s : null;
}

export function bblFromFootprint(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const bbl = normalizeBbl(r.mappluto_bbl) ?? normalizeBbl(r.base_bbl);
    if (bbl) return bbl;
  }
  return null;
}

export function parsePluto(raw: unknown): BuildingFacts | null {
  if (!Array.isArray(raw) || !raw[0] || typeof raw[0] !== 'object') return null;
  const r = raw[0] as Record<string, unknown>;
  const bbl = normalizeBbl(r.bbl);
  if (!bbl) return null;
  const buildingClass = text(r.bldgclass);
  const yearAltered = Math.max(positive(r.yearalter1) ?? 0, positive(r.yearalter2) ?? 0);
  const floors = positive(r.numfloors);
  return {
    bbl,
    address: text(r.address),
    floors: floors === null ? null : Math.round(floors * 10) / 10,
    unitsResidential: num(r.unitsres),
    unitsTotal: num(r.unitstotal),
    buildingAreaSqft: positive(r.bldgarea),
    lotAreaSqft: positive(r.lotarea),
    buildingsOnLot: positive(r.numbldgs),
    buildingClass,
    buildingClassLabel: buildingClassLabel(buildingClass),
    landUse: LAND_USE[String(num(r.landuse) ?? '')] ?? null,
    yearBuilt: positive(r.yearbuilt),
    yearAltered: yearAltered > 0 ? yearAltered : null,
    ownership: OWNERSHIP[String(r.ownertype ?? '').toUpperCase()] ?? null,
    zoning: text(r.zonedist1),
    historicDistrict: text(r.histdist),
    landmark: text(r.landmark),
  };
}

const PLUTO_FIELDS = [
  'bbl', 'address', 'numfloors', 'unitsres', 'unitstotal', 'bldgarea', 'lotarea', 'numbldgs', 'bldgclass',
  'landuse', 'yearbuilt', 'yearalter1', 'yearalter2', 'ownertype', 'zonedist1', 'histdist', 'landmark',
].join(',');

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).hostname}`);
  return res.json();
}

/** Resolves to null when the building has no lot record (new BIN, unmatched footprint). */
async function loadFacts(bin: string): Promise<BuildingFacts | null> {
  const foot = await getJson(`${FOOTPRINT_ATTRS_URL}?bin=${bin}&$select=mappluto_bbl,base_bbl&$limit=5`);
  const bbl = bblFromFootprint(foot);
  if (!bbl) return null;
  return parsePluto(await getJson(`${PLUTO_URL}?bbl=${bbl}&$select=${PLUTO_FIELDS}&$limit=1`));
}

const cache = new Map<string, Promise<BuildingFacts | null>>();

/**
 * Facts for a BIN, cached for the session. Failures are not cached, so reopening the panel retries.
 * The request is shared between panels, so callers stop listening on unmount instead of aborting it.
 */
export function fetchBuildingFacts(bin: string): Promise<BuildingFacts | null> {
  if (!BIN_RE.test(bin)) return Promise.resolve(null);
  let pending = cache.get(bin);
  if (!pending) {
    pending = loadFacts(bin);
    cache.set(bin, pending);
    pending.catch(() => cache.delete(bin));
  }
  return pending;
}
