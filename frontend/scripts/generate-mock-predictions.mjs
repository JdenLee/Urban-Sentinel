#!/usr/bin/env node
/**
 * Generate deterministic MOCK inspection-priority predictions for the demo.
 *
 * Reads public/data/buildings-demo.geojson, picks real BINs with a fixed-seed PRNG and writes
 * public/data/mock-predictions.json in the frontend prediction contract (schema_version 1.0).
 * Every value is synthetic demonstration data, labelled data_mode: "mock".
 *
 * Usage: node scripts/generate-mock-predictions.mjs [--seed 20261017] [--count 120]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILDINGS = join(ROOT, 'public', 'data', 'buildings-demo.geojson');
const OUT = join(ROOT, 'public', 'data', 'mock-predictions.json');
const AS_OF_YEAR = 2026;

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
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

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

function explanationsFor(f) {
  const candidates = [
    { w: Math.abs(f.sar_acceleration_mm_year2) * 2.2, text: 'Accelerating satellite-derived displacement' },
    { w: Math.abs(f.sar_velocity_mm_year) * 0.6, text: `Sustained satellite-derived settlement (${Math.abs(f.sar_velocity_mm_year)} mm/yr)` },
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
  // Quarterly cumulative line-of-sight displacement since Jan 2024, derived from velocity + acceleration.
  const out = [];
  for (let q = 0; q <= 11; q++) {
    const year = 2024 + Math.floor(q / 4);
    const month = (q % 4) * 3 + 1;
    const t = q / 4;
    const noise = between(-0.35, 0.35);
    const d = f.sar_velocity_mm_year * t * 0.6 + 0.5 * f.sar_acceleration_mm_year2 * t * t + (q === 0 ? 0 : noise);
    out.push({ date: `${year}-${String(month).padStart(2, '0')}-01`, displacement_mm: round(d, 1) });
  }
  return out;
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
    return {
      bin: p.bin,
      score,
      rank: 0,
      priority: priorityFor(score),
      confidence: round(between(0.62, 0.93), 2),
      address: p.address,
      explanations: explanationsFor(factors),
      factors,
      movement_history: score >= 0.6 ? movementHistory(factors) : [],
    };
  });
  buildings.sort((a, b) => b.score - a.score || a.bin.localeCompare(b.bin));
  buildings.forEach((b, i) => (b.rank = i + 1));

  const out = {
    schema_version: '1.0',
    generated_at: '2026-10-17T18:00:00Z',
    data_mode: 'mock',
    disclaimer: 'MOCK DATA — synthetic demonstration values, not model output.',
    model: { name: 'facade-inspection-priority', version: 'mock-v1', execution_platform: 'IBM LinuxONE' },
    generator: { script: 'frontend/scripts/generate-mock-predictions.mjs', seed: SEED },
    buildings,
  };
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
  const counts = buildings.reduce((m, b) => ((m[b.priority] = (m[b.priority] ?? 0) + 1), m), {});
  console.log(`Wrote ${buildings.length} mock predictions (seed ${SEED})`, counts, '→', OUT);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
