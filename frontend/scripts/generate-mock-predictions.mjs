#!/usr/bin/env node
/**
 * Generate deterministic MOCK inspection-priority predictions for the demo.
 *
 * Reads public/data/buildings-demo.geojson, picks real BINs with a fixed-seed PRNG and writes
 * public/data/mock-predictions.json in the frontend prediction contract (schema_version 1.1).
 * Every value is synthetic demonstration data, labelled data_mode: "mock". It exists to exercise
 * every UI section; the backend export replaces it.
 *
 * Usage: node scripts/generate-mock-predictions.mjs [--seed 20261017] [--count 600]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILDINGS = join(ROOT, 'public', 'data', 'buildings-demo.geojson');
const OUT = join(ROOT, 'public', 'data', 'mock-predictions.json');
const AS_OF_YEAR = 2026;
const DATA_AS_OF = '2026-10-01';

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const SEED = argVal('--seed', 20261017);
const COUNT = argVal('--count', 600);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const between = (lo, hi) => lo + (hi - lo) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const randDate2026 = () =>
  `2026-0${1 + Math.floor(between(0, 8))}-${String(1 + Math.floor(between(0, 27))).padStart(2, '0')}`;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function priorityFor(score) {
  if (score >= 0.85) return 'critical';
  if (score >= 0.7) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

/** Target score bands so the demo shows every category. */
const BANDS = [
  { n: 9, lo: 0.86, hi: 0.97 },
  { n: 28, lo: 0.7, hi: 0.849 },
  { n: 110, lo: 0.45, hi: 0.699 },
];

function factorsFor(score, building) {
  const s = score;
  const age = building.year_built ? AS_OF_YEAR - building.year_built : Math.round(between(60, 110));
  return {
    sar_velocity_mm_year: round(-(0.4 + s * 8 * between(0.75, 1.15)), 1),
    sar_acceleration_mm_year2: round(-(s > 0.6 ? s * 2.6 * between(0.6, 1.2) : between(0, 0.5)), 1),
    violations_12m: Math.max(0, Math.round(s * 5 * between(0.4, 1.3))),
    complaints_12m: Math.max(0, Math.round(s * 8 * between(0.3, 1.3))),
    building_age_years: age,
  };
}

/** Mock per-feature contributions (log-odds scale), largest magnitude first. */
function contributionsFor(f, angular) {
  const c = [
    { label: 'LOS acceleration', value: `${f.sar_acceleration_mm_year2} mm/yr²`, contribution: round(-f.sar_acceleration_mm_year2 * 0.32, 2) },
    { label: 'LOS velocity', value: `${f.sar_velocity_mm_year} mm/yr`, contribution: round(-f.sar_velocity_mm_year * 0.09 - 0.25, 2) },
    { label: 'Façade complaints (12 mo)', value: String(f.complaints_12m), contribution: round(f.complaints_12m * 0.08 - 0.15, 2) },
    { label: 'Open DOB violations (12 mo)', value: String(f.violations_12m), contribution: round(f.violations_12m * 0.11 - 0.12, 2) },
    { label: 'Building age', value: `${f.building_age_years} yr`, contribution: round((f.building_age_years - 70) * 0.008, 2) },
  ];
  if (angular !== null) {
    c.push({ label: 'Angular distortion', value: `1/${Math.round(1 / angular)}`, contribution: round(angular * 400 - 0.05, 2) });
  }
  return c.filter((x) => x.contribution !== 0).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

function explanationsFor(f) {
  const candidates = [
    { w: Math.abs(f.sar_acceleration_mm_year2) * 2.2, text: 'Accelerating line-of-sight displacement' },
    { w: Math.abs(f.sar_velocity_mm_year) * 0.6, text: `Negative line-of-sight velocity (${f.sar_velocity_mm_year} mm/yr)` },
    { w: f.complaints_12m * 0.7, text: f.complaints_12m > 1 ? 'Multiple recent façade complaints' : 'Recent façade complaint on record' },
    { w: f.violations_12m * 0.9, text: `${f.violations_12m} open DOB violation${f.violations_12m === 1 ? '' : 's'} in the last 12 months` },
    { w: f.building_age_years > 90 ? 3.2 : f.building_age_years > 60 ? 1.8 : 0.3, text: 'Older building construction' },
  ];
  return candidates
    .filter((c) => c.w > 0.5)
    .sort((a, b) => b.w - a.w)
    .slice(0, 3)
    .map((c) => c.text);
}

function movementHistory(f) {
  // Quarterly cumulative LOS displacement since Jan 2024, with a seasonal/thermal baseline.
  const out = [];
  for (let q = 0; q <= 11; q++) {
    const year = 2024 + Math.floor(q / 4);
    const month = (q % 4) * 3 + 1;
    const t = q / 4;
    const seasonal = 0.9 * Math.sin((2 * Math.PI * (month - 1)) / 12);
    const noise = between(-0.35, 0.35);
    const d = f.sar_velocity_mm_year * t * 0.6 + 0.5 * f.sar_acceleration_mm_year2 * t * t + (q === 0 ? 0 : seasonal + noise);
    out.push({
      date: `${year}-${String(month).padStart(2, '0')}-01`,
      displacement_mm: round(d, 1),
      baseline_mm: round(q === 0 ? 0 : seasonal, 1),
    });
  }
  return out;
}

function recordHistory(score, f) {
  const events = [];
  const fispStatus = score >= 0.7 ? pick(['SWARMP', 'UNSAFE']) : score >= 0.45 ? pick(['SAFE', 'SWARMP']) : 'SAFE';
  events.push({ date: '2024-02-15', type: 'FISP filing', description: `Cycle 9 façade report: ${fispStatus}` });
  events.push({ date: '2019-06-03', type: 'FISP filing', description: `Cycle 8 façade report: ${score >= 0.8 ? 'SWARMP' : 'SAFE'}` });
  const violations = ['Failure to maintain exterior wall', 'Loose façade masonry', 'Sidewalk shed required'];
  for (let i = 0; i < Math.min(f.violations_12m, 2); i++) {
    events.push({ date: randDate2026(), type: 'DOB violation', description: pick(violations) });
  }
  if (f.complaints_12m > 0) {
    events.push({
      date: randDate2026(),
      type: '311 complaint',
      description: `${f.complaints_12m} façade complaint${f.complaints_12m === 1 ? '' : 's'} in 12 months`,
    });
  }
  return events.sort((a, b) => b.date.localeCompare(a.date));
}

function consequenceFor(b) {
  return {
    occupancy: pick(['Residential', 'Mixed use', 'Office', 'Retail + residential']),
    floors: Math.max(2, Math.round((b.height_m ?? 12) / 3.4)),
    pedestrian_exposure: pick(['High', 'High', 'Medium', 'Low']),
  };
}

async function main() {
  const fc = JSON.parse(await readFile(BUILDINGS, 'utf8'));
  const props = fc.features.map((f) => f.properties).filter((p) => p.address && p.height_m);

  // The headline building should be a visible pre-war mid-rise, so the demo shot reads well.
  const headline = shuffle(props.filter((p) => p.height_m >= 45 && p.height_m <= 110 && p.year_built && p.year_built < 1935));
  const pool = shuffle(props.filter((p) => p.height_m >= 12));
  const chosen = [];
  const seen = new Set();
  for (const p of [...headline.slice(0, 6), ...pool]) {
    if (chosen.length >= COUNT) break;
    if (seen.has(p.bin)) continue;
    seen.add(p.bin);
    chosen.push(p);
  }

  const scores = [];
  for (const band of BANDS) for (let i = 0; i < band.n; i++) scores.push(between(band.lo, band.hi));
  while (scores.length < chosen.length) scores.push(between(0.04, 0.44));
  // Headline candidates get the top scores.
  scores.sort((a, b) => b - a);

  const buildings = chosen.map((p, i) => {
    const score = round(scores[i], 3);
    const factors = factorsFor(score, p);
    const halfWidth = between(0.04, 0.12);
    const angular = score >= 0.6 ? round(1 / Math.round(between(1200, 4500)), 6) : null;
    const completeness = round(between(0.7, 1), 2);
    return {
      bin: p.bin,
      score,
      rank: 0,
      priority: priorityFor(score),
      probability: round(clamp01(score * between(0.55, 0.85)), 3),
      score_interval: [round(clamp01(score - halfWidth), 2), round(clamp01(score + halfWidth * 0.8), 2)],
      address: p.address,
      explanations: explanationsFor(factors),
      factors,
      contributions: contributionsFor(factors, angular),
      angular_distortion: angular,
      consequence: consequenceFor(p),
      record_history: recordHistory(score, factors),
      completeness,
      missing_inputs: completeness < 0.85 ? [pick(['Façade material', 'Last FISP inspection date', 'Number of units'])] : [],
      sources: [
        { name: 'Sentinel-1 InSAR (mock)', observed_at: '2026-07-01' },
        { name: 'DOB façade filings (FISP)', observed_at: '2026-09-30' },
        { name: 'DOB/ECB violations', observed_at: '2026-09-30' },
        { name: 'NYC 311 complaints', observed_at: '2026-09-28' },
      ],
      movement_history: score >= 0.6 ? movementHistory(factors) : [],
    };
  });
  buildings.sort((a, b) => b.score - a.score || a.bin.localeCompare(b.bin));
  buildings.forEach((b, i) => (b.rank = i + 1));

  const out = {
    schema_version: '1.1',
    generated_at: '2026-10-17T18:00:00Z',
    data_as_of: DATA_AS_OF,
    data_mode: 'mock',
    disclaimer: 'MOCK DATA — synthetic demonstration values, not model output.',
    model: {
      name: 'facade-inspection-priority',
      version: 'mock-v1',
      execution_platform: 'IBM LinuxONE',
      trained_through: '2026-06-30',
    },
    model_card: {
      target: 'Recorded façade problem (UNSAFE/SWARMP filing or façade violation) within 12 months',
      score_definition:
        'Normalized inspection-priority score (0–1): predicted 12-month probability weighted by consequence (occupancy, pedestrian exposure) and rescaled across scored buildings.',
      confidence_definition: null,
      metrics: [
        { label: 'Backtest hit rate @ top 100', value: null },
        { label: 'Lift vs building-age baseline', value: null },
        { label: 'Lift vs complaint-count baseline', value: null },
        { label: 'Median lead time', value: null },
        { label: 'Backtest sample size', value: null },
      ],
      limitations: [
        'Ranks buildings for human review; it is not a structural simulation and does not predict collapse.',
        'InSAR measures line-of-sight motion; vertical settlement is not reconstructed.',
        'Buildings with sparse inspection history are scored with less certainty.',
        'Recorded outcomes depend on owners filing; non-filers are missing not at random.',
      ],
    },
    movement: {
      measurement: 'Line-of-sight (LOS) velocity',
      units: 'mm/yr',
      source: 'Sentinel-1 InSAR (mock values)',
      posting_m: 30,
      aggregation_m: 60,
      period_start: '2024-01-01',
      period_end: '2026-07-01',
    },
    generator: { script: 'frontend/scripts/generate-mock-predictions.mjs', seed: SEED },
    buildings,
  };
  await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
  const counts = buildings.reduce((m, b) => ((m[b.priority] = (m[b.priority] ?? 0) + 1), m), {});
  console.log(`Wrote ${buildings.length} mock predictions (seed ${SEED})`, counts, '→', OUT);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
