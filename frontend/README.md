# NYC Structural Risk Digital Twin (frontend)

A cinematic 3D map of Lower Manhattan that visualises façade **inspection-priority** scores from our
model running on IBM LinuxONE. Built for the IBM Z Datathon presentation.

> This is a decision-support tool. Scores show **elevated warning signals** and buildings
> **recommended for further review**. They are not predictions of structural collapse, and every
> flagged building needs a field inspection.

- 10,291 real NYC building footprints (Battery Park to 14th Street), extruded by roof height
- 600 scored buildings coloured Low / Medium / High / Critical, joined to footprints by BIN
- Click a building (or a row in the top-priority list) for its score, rank, warning signals, model factors and a
  displacement-history chart
- Optional satellite-movement layer (deck.gl `HexagonLayer`)
- **Play Demo**: a fixed 30-second camera sequence for recording, which stops when you touch the map or press `Esc`
- A **Mock data** badge is shown whenever the prediction file has `"data_mode": "mock"`

## Quick start

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check (`tsc -b`) and production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Vitest: BIN join, thresholds, validation, committed-data checks |
| `npm run prepare-buildings` | Rebuild `public/data/buildings-demo.geojson` from NYC Open Data |
| `npm run generate-mock` | Rebuild `public/data/mock-predictions.json` (deterministic, seed 20261017) |

Requires Node 20 or later. Both data files are committed, so the demo does not depend on the NYC Open Data API.
The basemap tiles (OpenFreeMap) do need internet access. If the basemap can't load, the app shows a notice and
still renders the scored buildings on a dark background.

## Replacing mock predictions with real model output

Overwrite `public/data/mock-predictions.json` with the real export. No code changes are needed. The loader
accepts two shapes:

**1. Frontend contract (schema_version 1.0)**

```jsonc
{
  "schema_version": "1.0",
  "generated_at": "2026-10-17T18:00:00Z",
  "data_mode": "real",                       // "mock" shows the Mock data badge
  "model": { "name": "facade-inspection-priority", "version": "v1", "execution_platform": "IBM LinuxONE" },
  "buildings": [
    {
      "bin": "1000010",                       // string; join key to footprints
      "score": 0.92,                          // required, 0..1
      "rank": 1,                              // optional; derived from score if any record lacks it
      "priority": "critical",                 // optional; derived from score if absent
      "confidence": 0.84,                     // optional
      "address": "Example address",           // optional; falls back to the footprint address
      "explanations": ["…", "…", "…"],        // top three are shown
      "factors": { "sar_velocity_mm_year": -8.4, "violations_12m": 4 },
      "movement_history": [{ "date": "2026-01-01", "displacement_mm": -1.2 }]
    }
  ]
}
```

**2. ML service output** (`ml/contract/building_score.schema.json` on `feature/nyc-ml`, e.g. `GET /top`):
`{ meta, buildings: [{ bin, address, prediction: { probability, rank, tier, scored_on }, drivers }] }`.
`probability` becomes the score. `drivers` that raise the score become explanations, and all drivers are listed
as factors. Rank-percentile tiers map as `high → Critical`, `elevated → High`, `typical → Medium`, `low → Low`.
Records with `prediction: null` (already filed this cycle) are skipped. If `scored_on.machine` is `s390x`, the
badge reads "IBM LinuxONE".

Default thresholds, used only when no priority or tier is supplied:

| Category | Score |
| --- | --- |
| Critical | ≥ 0.85 |
| High | ≥ 0.70 |
| Medium | ≥ 0.45 |
| Low | < 0.45 |

Validation: BINs are normalised to 7-digit strings. A record is skipped, with a console warning, if its score is
missing, non-numeric or outside 0–1, or if its BIN is invalid or duplicated. Predictions whose BIN isn't in the
demo area are ignored. Footprints without a roof height use 12 m and the panel says "Height unknown".

The satellite-movement layer uses each scored building's `factors.sar_velocity_mm_year`. In mock mode, unscored
footprints also get a small deterministic background value so the field looks continuous. Real data never gets
synthetic points, and the toggle is disabled if no velocities are supplied.

## Demo Mode timeline

Every run is identical (`src/components/DemoController.tsx`):

| Time | Shot |
| --- | --- |
| 0–5 s | Reset layers, start high over the harbour, fly into Lower Manhattan |
| 5–10 s | Inspection-priority layer on: buildings fade from gray to risk colours during a slow orbit |
| 10–17 s | Fly to the #1-ranked building; selection beacon appears |
| 17–24 s | Building panel opens (score, rank, warning signals, movement chart) while the camera orbits |
| 24–30 s | Satellite-movement layer rises in; finish on an overview shot |

Recording tips: use a 1440×900 or 1920×1080 browser window and let the page sit for a few seconds first so the
basemap tiles are cached. Then click **Play Demo**. Clicking, dragging or scrolling the map, or pressing `Esc`,
stops the sequence. **Reset View** returns to the opening camera. Outside Demo Mode, camera moves become jumps
when the OS "reduce motion" setting is on.

## Building data preparation

`scripts/prepare-buildings.mjs`:

1. Downloads [NYC Building Footprints](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue) inside the demo
   bounding box (`-74.022, 40.700, -73.970, 40.735`) and [MapPLUTO](https://data.cityofnewyork.us/d/64uk-42ks) addresses
   for Manhattan. Responses are cached in `.cache/`; pass `--refresh` to download again, or `--input file.geojson` to
   read a local export.
2. Stores BIN as a string (the API returns a number) and drops DOB placeholder BINs (`1000000`).
3. Keeps `bin`, `address`, `height_m` and `year_built` only. For a BIN with several parts, the largest part is kept.
4. Converts `height_roof` from feet to metres.
5. Simplifies outlines with Douglas–Peucker (0.25 m tolerance) and rounds coordinates to 6 decimals (about 0.1 m).

The output is 3.7 MB (about 1 MB gzipped). To change the area, edit `DEMO_BBOX` in both the script and
`src/camera.ts`, then run `npm run prepare-buildings && npm run generate-mock`.

## Project structure

```
frontend/
├── public/data/            buildings-demo.geojson, mock-predictions.json
├── scripts/                prepare-buildings.mjs, generate-mock-predictions.mjs
└── src/
    ├── components/         MapScene, BuildingPanel, LayerControls, RiskLegend, DemoController
    ├── data/               loadBuildings, loadPredictions (validation + ML-contract adapter), joinByBin, priority
    ├── layers/             buildingRiskLayer (GeoJsonLayer), movementHexagonLayer (HexagonLayer)
    ├── types/predictions.ts
    ├── camera.ts           demo bounding box, initial camera, reduced-motion helper
    └── App.tsx, main.tsx, styles.css
```

## Credits and licences

**Libraries** (all open source, installed from npm, no code vendored):

| Library | Licence |
| --- | --- |
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | BSD-3-Clause |
| [deck.gl](https://github.com/visgl/deck.gl) (`@deck.gl/core`, `layers`, `aggregation-layers`, `mapbox`) | MIT |
| [react-map-gl](https://github.com/visgl/react-map-gl) | MIT |
| [React](https://react.dev) | MIT |
| [Vite](https://vitejs.dev), [Vitest](https://vitest.dev), [TypeScript](https://www.typescriptlang.org) | MIT / MIT / Apache-2.0 |

**Data and tiles**

- Building footprints: NYC Office of Technology and Innovation, [Building Footprints](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue), NYC Open Data ([Terms of Use](https://www.nyc.gov/home/terms-of-use.page))
- Addresses: NYC Department of City Planning, [MapPLUTO](https://data.cityofnewyork.us/d/64uk-42ks), NYC Open Data
- Basemap: [OpenFreeMap](https://openfreemap.org) "dark" style, built on [OpenMapTiles](https://openmaptiles.org) © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). Attribution is shown on the map.
- Predictions in `mock-predictions.json` are **synthetic** and generated by `scripts/generate-mock-predictions.mjs`. Their addresses and BINs are real, but the scores, factors and movement histories are made up for demonstration.

**References (no code copied)**

- [MapLibre 3D buildings example](https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/)
- [deck.gl HexagonLayer docs](https://deck.gl/docs/api-reference/aggregation-layers/hexagon-layer)
- [react-visgl-maplibre starter](https://github.com/Trapar-waves/react-visgl-maplibre) (MIT), for the overlay integration pattern
- [manhattan-3d](https://github.com/anchitjaincfa/manhattan-3d), for performance and visual reference only, because its licence is unconfirmed
