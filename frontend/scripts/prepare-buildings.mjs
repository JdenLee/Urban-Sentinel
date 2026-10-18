#!/usr/bin/env node
/**
 * Prepare the demo building-footprint overlay.
 *
 * 1. Downloads NYC Building Footprints (NYC Open Data 5zhs-2jue) inside the demo bounding box,
 *    MapPLUTO lot attributes (64uk-42ks) for Manhattan, and the exterior wall types recorded on
 *    DOB NOW façade filings (xubg-57si). Raw responses are cached in .cache/.
 * 2. Treats BIN as a string (the API returns it as a number).
 * 3. Keeps only Manhattan BINs (1xxxxxx) inside the demo area.
 * 4. Keeps bin, address, height_m, year_built, floors, and a façade material class.
 * 5. Converts roof height from feet to metres.
 * 6. Simplifies geometry with Douglas-Peucker at a sub-metre tolerance and rounds coordinates
 *    to 6 decimals (~0.1 m), which is invisible at street level.
 * 7. Writes public/data/buildings-demo.geojson.
 *
 * The material class drives the procedural façade shader. It is taken from the inspector-recorded
 * wall type where a façade filing exists, and otherwise inferred from construction era and use,
 * which `material_source` records so the map can say which is which.
 *
 * Usage: node scripts/prepare-buildings.mjs [--refresh]
 * Optional: --input path/to/footprints.geojson to read a local export instead of the API.
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache');
const OUT = join(ROOT, 'public', 'data', 'buildings-demo.geojson');

// Lower Manhattan: Battery Park to 14th Street.
export const DEMO_BBOX = { north: 40.735, west: -74.022, south: 40.7, east: -73.97 };

const FOOTPRINTS_API = 'https://data.cityofnewyork.us/resource/5zhs-2jue.json';
const PLUTO_API = 'https://data.cityofnewyork.us/resource/64uk-42ks.json';
const FACADE_API = 'https://data.cityofnewyork.us/resource/xubg-57si.json';
const PAGE = 5000;
const FEET_TO_M = 0.3048;
const SIMPLIFY_TOLERANCE_M = 0.25;
const MIN_AREA_SQFT = 20; // drop slivers and kiosks

const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const inputIdx = args.indexOf('--input');
const inputPath = inputIdx >= 0 ? args[inputIdx + 1] : null;

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchAll(url, params, cacheName) {
  const cachePath = join(CACHE, cacheName);
  if (!refresh && (await exists(cachePath))) {
    console.log(`  using cache ${cacheName}`);
    return JSON.parse(await readFile(cachePath, 'utf8'));
  }
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = new URLSearchParams({ ...params, $limit: String(PAGE), $offset: String(offset) });
    const res = await fetch(`${url}?${q}`);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    process.stdout.write(`  ${cacheName}: ${rows.length} rows\r`);
    if (page.length < PAGE) break;
  }
  process.stdout.write('\n');
  await mkdir(CACHE, { recursive: true });
  await writeFile(cachePath, JSON.stringify(rows));
  return rows;
}

/** BINs and BBLs arrive as numbers or decimal strings ("1000010.00"); normalise to an integer string. */
export function idString(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  const n = s.includes('.') ? s.slice(0, s.indexOf('.')) : s;
  return /^\d+$/.test(n) ? n : null;
}

function perpDist(p, a, b, kx, ky) {
  const px = (p[0] - a[0]) * kx, py = (p[1] - a[1]) * ky;
  const bx = (b[0] - a[0]) * kx, by = (b[1] - a[1]) * ky;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

function douglasPeucker(points, tol, kx, ky) {
  if (points.length <= 2) return points;
  let maxD = 0, idx = 0;
  const a = points[0], b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], a, b, kx, ky);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [a, b];
  const left = douglasPeucker(points.slice(0, idx + 1), tol, kx, ky);
  const right = douglasPeucker(points.slice(idx), tol, kx, ky);
  return left.slice(0, -1).concat(right);
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

function simplifyRing(ring) {
  const lat = ring[0][1];
  const ky = 111_320;
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  // Split the closed ring at its farthest point so DP keeps both "ends" of the shape.
  const open = ring.slice(0, -1);
  if (open.length < 4) return ring.map(([x, y]) => [round6(x), round6(y)]);
  let far = 0, farD = 0;
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot((open[i][0] - open[0][0]) * kx, (open[i][1] - open[0][1]) * ky);
    if (d > farD) { farD = d; far = i; }
  }
  const a = douglasPeucker(open.slice(0, far + 1), SIMPLIFY_TOLERANCE_M, kx, ky);
  const b = douglasPeucker(open.slice(far).concat([open[0]]), SIMPLIFY_TOLERANCE_M, kx, ky);
  let out = a.slice(0, -1).concat(b.slice(0, -1)).map(([x, y]) => [round6(x), round6(y)]);
  out = out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
  if (out.length < 3) return ring.map(([x, y]) => [round6(x), round6(y)]);
  out.push(out[0]);
  return out;
}

function simplifyGeometry(geom) {
  if (!geom) return null;
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : geom.type === 'Polygon' ? [geom.coordinates] : null;
  if (!polys) return null;
  const simplified = polys.map((rings) => rings.map(simplifyRing));
  return simplified.length === 1
    ? { type: 'Polygon', coordinates: simplified[0] }
    : { type: 'MultiPolygon', coordinates: simplified };
}

async function loadFootprints() {
  if (inputPath) {
    console.log(`Reading local footprints from ${inputPath}`);
    const fc = JSON.parse(await readFile(inputPath, 'utf8'));
    return fc.features.map((f) => ({ ...f.properties, the_geom: f.geometry }));
  }
  const { north, west, south, east } = DEMO_BBOX;
  console.log('Downloading NYC Building Footprints (5zhs-2jue)…');
  return fetchAll(
    FOOTPRINTS_API,
    {
      $select: 'bin,base_bbl,height_roof,construction_year,shape_area,the_geom',
      $where: `within_box(the_geom, ${north}, ${west}, ${south}, ${east}) AND bin >= 1000000 AND bin < 2000000`,
      $order: 'bin',
    },
    'footprints-demo.json',
  );
}

/** Lot attributes keyed by BBL: address plus the storey count and use class the shader needs. */
async function loadLots() {
  console.log('Downloading MapPLUTO lot attributes for Manhattan (64uk-42ks)…');
  const rows = await fetchAll(
    PLUTO_API,
    { $select: 'bbl,address,numfloors,bldgclass,yearbuilt', $where: "borough = 'MN'", $order: 'bbl' },
    'pluto-mn.json',
  );
  const map = new Map();
  for (const r of rows) {
    const bbl = idString(r.bbl);
    if (!bbl) continue;
    const floors = Math.round(Number(r.numfloors));
    map.set(bbl, {
      address: r.address ? r.address.replace(/\s+/g, ' ').trim() : null,
      floors: Number.isFinite(floors) && floors > 0 ? floors : null,
      bldgclass: r.bldgclass ?? null,
      yearbuilt: Number(r.yearbuilt) > 1700 ? Number(r.yearbuilt) : null,
    });
  }
  return map;
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function ordinal(n) {
  const v = Number(n) % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** PLUTO writes numbered streets bare ("39 5 AVENUE"); render them as "39 5th Avenue". */
export function formatAddress(raw) {
  return titleCase(raw).replace(/^(\S+ (?:(?:East|West) )?)(\d+) (Avenue|Street|Place)\b/, (_, pre, n, kind) => `${pre}${ordinal(n)} ${kind}`);
}

/**
 * Façade material classes rendered by the shader. Order matters: a filing lists several wall types
 * ("BRICK MASONRY; TERRA COTTA"), and the first match wins, so the visually dominant cladding is
 * listed before the structure behind it.
 */
const WALL_TYPE_MATCHERS = [
  ['curtain', ['CURTAIN WALL', 'METAL & GLASS', 'GLASS']],
  ['cast_iron', ['CAST IRON']],
  ['terra_cotta', ['TERRA COTTA']],
  ['stone', ['STONE', 'MARBLE', 'LIMESTONE', 'GRANITE']],
  ['metal', ['METAL SIDING', 'METAL PANEL', 'ALUMINUM']],
  ['stucco', ['STUCCO', 'EIFS']],
  ['concrete', ['PRECAST', 'CONCRETE']],
  ['brick', ['BRICK', 'MASONRY']],
];

/** The inspector-recorded wall type, which is the only direct evidence of what a façade is made of. */
export function materialFromWallType(text) {
  if (!text) return null;
  const upper = text.toUpperCase();
  for (const [material, tokens] of WALL_TYPE_MATCHERS) {
    if (tokens.some((t) => upper.includes(t))) return material;
  }
  return null;
}

/**
 * Fallback for the ~90% of footprints with no façade filing (only buildings over six storeys file).
 * These are construction-era conventions for Manhattan, not records, and are flagged as inferred.
 */
export function materialFromEra(bldgclass, yearBuilt, floors) {
  const cls = (bldgclass ?? '').toUpperCase();
  const year = Number.isFinite(yearBuilt) ? yearBuilt : null;
  const storeys = Number.isFinite(floors) && floors > 0 ? floors : null;
  if (cls.startsWith('G') || cls.startsWith('T') || cls.startsWith('U')) return 'concrete'; // garages, transport, utility
  if (year === null) return 'brick';
  if (year >= 1995 && (storeys ?? 0) >= 8) return 'curtain';
  if (year >= 1960 && (storeys ?? 0) >= 20) return 'curtain';
  if (year >= 1950 && (storeys ?? 0) >= 10) return 'concrete';
  // Prewar towers are overwhelmingly terra-cotta-clad above a stone base.
  if (year >= 1900 && year < 1945 && (storeys ?? 0) >= 10) return 'terra_cotta';
  // Cast iron is specific to the SoHo/Tribeca commercial lofts of the second half of the 1800s,
  // not to pre-1900 buildings generally, so it needs the loft or store class as well as the era.
  const loft = cls.startsWith('L') || cls.startsWith('K');
  if (loft && year >= 1850 && year < 1900 && (storeys ?? 0) >= 4 && (storeys ?? 0) <= 8) return 'cast_iron';
  return 'brick';
}

/** Latest recorded exterior wall type per BIN, from DOB NOW façade filings. */
async function loadWallTypes() {
  console.log('Downloading recorded exterior wall types (xubg-57si)…');
  const rows = await fetchAll(
    FACADE_API,
    {
      $select: 'bin,cycle,exterior_wall_type_s_',
      $where: "exterior_wall_type_s_ IS NOT NULL AND starts_with(bin, '1')",
      $order: 'bin,cycle',
    },
    'facade-wall-types-mn.json',
  );
  // Rows are ordered by cycle, so the last write per BIN is the most recent inspection.
  const map = new Map();
  for (const r of rows) {
    const bin = idString(r.bin);
    const material = materialFromWallType(r.exterior_wall_type_s_);
    if (bin && material) map.set(bin, material);
  }
  return map;
}

async function main() {
  const [rows, lots, wallTypes] = await Promise.all([loadFootprints(), loadLots(), loadWallTypes()]);
  const { north, west, south, east } = DEMO_BBOX;
  const byBin = new Map();
  let dropped = 0;
  let recorded = 0;

  for (const r of rows) {
    const bin = idString(r.bin);
    // 1000000, 2000000 … are DOB placeholder BINs shared by many unrelated structures.
    if (!bin || !/^1\d{6}$/.test(bin) || /^[1-5]000000$/.test(bin)) { dropped++; continue; }
    if (Number(r.shape_area) < MIN_AREA_SQFT) { dropped++; continue; }
    const geometry = simplifyGeometry(r.the_geom);
    if (!geometry) { dropped++; continue; }
    const first = geometry.type === 'Polygon' ? geometry.coordinates[0][0] : geometry.coordinates[0][0][0];
    if (first[1] > north || first[1] < south || first[0] < west || first[0] > east) { dropped++; continue; }

    const heightFt = Number(r.height_roof);
    const height_m = Number.isFinite(heightFt) && heightFt > 0 ? Math.round(heightFt * FEET_TO_M * 10) / 10 : null;
    const year = Number(r.construction_year);
    const bbl = idString(r.base_bbl);
    const lot = (bbl && lots.get(bbl)) || null;
    const address = lot?.address ? formatAddress(lot.address) : null;
    // The footprint's own construction year is the more specific of the two; PLUTO is per lot.
    const year_built = Number.isFinite(year) && year > 1700 ? year : lot?.yearbuilt ?? null;

    const fromFiling = wallTypes.get(bin) ?? null;
    if (fromFiling) recorded++;

    const feature = {
      type: 'Feature',
      properties: {
        bin,
        address,
        height_m,
        year_built,
        floors: lot?.floors ?? null,
        material: fromFiling ?? materialFromEra(lot?.bldgclass, year_built, lot?.floors),
        material_source: fromFiling ? 'filing' : 'inferred',
      },
      geometry,
    };
    // Keep every component and its measured height, while BIN remains a unique model/search key.
    const prev = byBin.get(bin);
    const part = { geometry, height_m };
    if (!prev) byBin.set(bin, { area: Number(r.shape_area), feature, parts: [part] });
    else {
      prev.parts.push(part);
      if (Number(r.shape_area) > prev.area) { prev.area = Number(r.shape_area); prev.feature = feature; }
    }
  }

  const features = [...byBin.values()].map((v) => {
    if (v.parts.length > 1) {
      v.feature.properties.parts = v.parts;
      v.feature.properties.height_m = Math.max(...v.parts.map((p) => p.height_m ?? 0)) || null;
    }
    return v.feature;
  }).sort((a, b) => a.properties.bin.localeCompare(b.properties.bin));
  recorded = features.filter((f) => f.properties.material_source === 'filing').length;
  const fc = {
    type: 'FeatureCollection',
    metadata: {
      source:
        'NYC Open Data — Building Footprints (5zhs-2jue); lot attributes from MapPLUTO (64uk-42ks); ' +
        'exterior wall types from DOB NOW Façade Compliance Filings (xubg-57si)',
      bbox: [west, south, east, north],
      generated_by: 'frontend/scripts/prepare-buildings.mjs',
      geometry_note: 'One BIN per building; source footprint components retain individual roof heights. No inferred setbacks or roof shapes.',
      units: { height_m: 'metres (converted from height_roof in feet)' },
      material: {
        classes: WALL_TYPE_MATCHERS.map(([id]) => id),
        recorded: recorded,
        inferred: features.length - recorded,
        note: "material_source is 'filing' where an inspector recorded the exterior wall type, otherwise 'inferred' from construction era and building class",
      },
    },
    features,
  };
  await mkdir(dirname(OUT), { recursive: true });
  const json = JSON.stringify(fc);
  await writeFile(OUT, json);
  console.log(`Wrote ${features.length} buildings (${(json.length / 1e6).toFixed(2)} MB), dropped ${dropped} rows → ${OUT}`);
  console.log(`  façade material: ${recorded} from filings, ${features.length - recorded} inferred`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
