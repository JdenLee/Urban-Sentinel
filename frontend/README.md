# NYC Façade Early-Warning System (frontend)

A 3D map of Lower Manhattan that ranks buildings for **façade inspection priority**. It was built for the IBM Z
Datathon, and the predictions are meant to run on IBM LinuxONE.

> **What this is:** a data-driven decision-support tool. It combines records and satellite-derived signals to order
> buildings for human review.
> **What this is not:** a physics-based digital twin, a structural simulation, or a prediction of collapse. Every
> flagged building needs a field inspection.

**Terminology used throughout the UI**

| Term | Meaning |
| --- | --- |
| Inspection priority | The ranked output. One consistent term; the UI never says "structural risk". |
| Priority score | A normalized 0–1 score. If the export's score *is* the probability (as the ML service output is), the UI labels it "Predicted probability" instead. |
| Prediction target | Whatever `model_card.target` in the prediction file says. It is shown in the model card. |
| Line-of-sight (LOS) velocity | InSAR motion along the satellite's view direction. It is not reconstructed vertical settlement. |

## Demo MVP vs full product roadmap

**Demo MVP (this branch)**
- 10,291 real footprints, extruded by roof height. Scored buildings are coloured Low / Medium / High / Critical, and
  the legend doubles as a category filter.
- **Building panel** with three tabs (scored buildings) or just History (any other building):
  - **Overview:** priority score with its uncertainty range, predicted probability, data completeness, the top three
    warning signals, consequence inputs (occupancy, floors, pedestrian exposure) and inspection status.
  - **Evidence:** signed per-feature contributions (SHAP-style), angular distortion, and the model inputs.
  - **History:** FISP status on record, the satellite ground-movement chart (building vs its ~2 km neighbourhood,
    2016 → latest), every FISP filing plus DOB/ECB façade violations and 311 façade complaints (with type filters),
    and each source with its observation date. Movement is context only: it is not a model input.
- **Look up any NYC building:**
  - Type an address (NYC GeoSearch suggestions) or a 7-digit BIN. Scored buildings in the scene come first.
  - Outside the Lower Manhattan scene the camera flies there and draws that building's footprint (fetched by BIN).
  - Click any footprint in the scene, scored or not, to open its history.
- **Operational tools:**
  - an inspection-capacity slider with a ranked shortlist and an option to colour only the shortlist on the map
  - per-building assignment status (Unassigned / Assigned / Inspected / Deferred, stored in this browser only)
  - CSV export of the shortlist
- **Model card:** target, score definition, backtest metrics, provenance (version, runtime, trained-through date,
  data as of, last refresh) and limitations.
- **Satellite movement layer:** 60 m hexagons with **their own legend and a separate purple palette**, so they can't
  be confused with the priority colours. The legend shows units, period, source, and the 30 m posting it is
  aggregated from.
- **Play Demo:** a fixed, interruptible 30-second sequence.

**Full product roadmap (not built; needs backend data first)**
- A 2016–present displacement timeline with a time slider
- Forward projections with uncertainty bands
- Flood and storm-surge scenario overlays
- Alert markers for threshold crossings, and recorded outcomes for closing the loop
- Shared, server-side assignment and work-order status instead of per-browser storage
- An all-borough footprint coverage (today: lookups anywhere, but only the demo area is drawn in full)

Each roadmap item depends on new fields in the prediction export. The frontend already ignores fields it doesn't
know, so they can be added one at a time.

## Quick start

```bash
cd frontend
npm install
cp .env.example .env.local   # VITE_API_URL: live predictions + building history (default http://localhost:8000)
npm run dev        # http://localhost:5173
```

Building history comes from the same ML API (`GET /buildings/{bin}/history`). Run it locally from `ml/`
(`uvicorn urban_sentinel.serve:app --port 8000`) or tunnel to the LinuxONE deployment, and point `VITE_API_URL` at
it. Without it the scene, snapshot scores, search and demo still work, and the History tab says what is missing.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check (`tsc -b`) and production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Vitest: BIN join, thresholds, validation, optional fields, ML adapter, search (scene + address + BIN), history parsing, footprint lookup, CSV export, demo determinism, committed-data checks |
| `npm run prepare-buildings` | Rebuild `public/data/buildings-demo.geojson` from NYC Open Data |
| `npm run generate-mock` | Rebuild `public/data/mock-predictions.json` (deterministic, seed 20261017) |

Requires Node 20 or later. Both data files are committed, so the demo doesn't depend on the NYC Open Data API. The
basemap tiles (OpenFreeMap) do need internet access. If the basemap can't load, the app shows a notice and still
renders the scored buildings.

**Supported viewports**
- **1280×720 and up:** sidebar and building panel side by side. This is the target for presentations.
- **761–1100 px:** the sidebar becomes a drawer (☰) and closes automatically when a building opens.
- **760 px and below:** the building panel becomes a bottom sheet.

**Demo camera.** `Play demo` explicitly starts the original PR #3's smooth 30-second camera tour:
wide approach, priority-color reveal, flight to the top-ranked building, evidence orbit and pullback.
The current responsive panel framing is retained. `Play without camera animation` runs the same
sequence using instant cuts. Ordinary search/reset navigation continues to respect the system's
Reduce Motion setting; Stop, Escape, or interacting with the map interrupts either demo mode.

## Prediction file contracts

Real predictions come from the sources listed under "Real data from IBM LinuxONE" below (live API, exported snapshot,
then mock). Any file in either contract works: only `bin` and `score` are required, and the UI hides any section
whose data is missing.

**Mock vs real data.**
- With `"data_mode": "mock"`, the UI shows a **Mock data** badge and a dashed **Target runtime: IBM LinuxONE** badge.
- With any other value, the badge reads **Predictions generated on IBM LinuxONE**.

**1. Frontend contract (schema_version 1.1)**

```jsonc
{
  "schema_version": "1.1",
  "generated_at": "2026-10-17T18:00:00Z",      // shown as "Last refresh"
  "data_as_of": "2026-10-01",                  // shown as "Data as of"
  "data_mode": "real",
  "model": { "name": "facade-inspection-priority", "version": "v1",
             "execution_platform": "IBM LinuxONE", "trained_through": "2026-06-30" },
  "model_card": {                              // optional; drives the Model card dialog
    "target": "…what the model predicts…",
    "score_definition": "…how the 0–1 score is built…",
    "confidence_definition": null,             // if null, per-building confidence is not displayed
    "metrics": [{ "label": "Backtest hit rate @ top 100", "value": "0.66" }],
    "limitations": ["…"]
  },
  "movement": { "measurement": "Line-of-sight (LOS) velocity", "units": "mm/yr", "source": "OPERA DISP-S1",
                "posting_m": 30, "aggregation_m": 60, "period_start": "2016-01-01", "period_end": "2026-07-01" },
  "buildings": [
    {
      "bin": "1000010",                         // required, string
      "score": 0.92,                            // required, 0..1
      "rank": 1, "priority": "critical",        // optional; derived from score if absent
      "probability": 0.71,                      // optional, 0..1
      "score_interval": [0.84, 0.97],           // optional uncertainty range
      "confidence": 0.84,                       // shown only if model_card.confidence_definition is set
      "address": "Example address",
      "explanations": ["…", "…", "…"],          // top three shown as warning signals
      "contributions": [{ "label": "LOS acceleration", "value": "-2.1 mm/yr²", "contribution": 0.61 }],
      "factors": { "sar_velocity_mm_year": -8.4, "violations_12m": 4 },
      "consequence": { "occupancy": "Residential", "floors": 12, "pedestrian_exposure": "High" },
      "angular_distortion": 0.00063,
      "record_history": [{ "date": "2024-02-15", "type": "FISP filing", "description": "Cycle 9: SWARMP" }],
      "completeness": 0.82, "missing_inputs": ["Façade material"],
      "sources": [{ "name": "DOB violations", "observed_at": "2026-09-30" }],
      "movement_history": [{ "date": "2026-01-01", "displacement_mm": -1.2, "baseline_mm": 0.3 }]
    }
  ]
}
```

**2. ML service output** (`ml/contract/building_score.schema.json` on `feature/nyc-ml`, e.g. `GET /top`)
- **Score and explanations.** `prediction.probability` becomes the score, and the UI labels it "Predicted
  probability". `drivers` become the contributions, using their `log_odds`. Drivers that raise the score also become
  the warning signals.
- **Records.** `fisp.history` becomes the record history and `missing` becomes the missing inputs.
- **Dates and model card.** `meta.as_of` becomes "Data as of", `meta.caveats` become the model-card limitations, and
  `meta.model.train_cycles` becomes "Trained through".
- **Tiers.** `high → Critical`, `elevated → High`, `typical → Medium`, `low → Low`.
- **Skipped records.** Records with `prediction: null` (already filed this cycle) are skipped.

Default thresholds, used only when no priority or tier is supplied:

| Category | Score |
| --- | --- |
| Critical | ≥ 0.85 |
| High | 0.70 – < 0.85 |
| Medium | 0.45 – < 0.70 |
| Low | < 0.45 |

**Validation**
- BINs are normalised to 7-digit strings.
- A record is skipped, with a console warning, if its score is missing, non-numeric or outside 0–1, or if its BIN is
  invalid or duplicated.
- An optional field that's out of range is dropped rather than shown.

The satellite layer uses `factors.sar_velocity_mm_year`. In mock mode, unscored footprints also get a small
deterministic background value. Real data never gets synthetic points, and the toggle is disabled if no velocities
are supplied.

## Demo Mode timeline

Every run is identical (`src/components/DemoController.tsx`). Before it starts, it clears any category or shortlist
filters.

| Time | Shot |
| --- | --- |
| 0–5 s | Reset layers, start high over the harbour, fly into Lower Manhattan |
| 5–10 s | Inspection-priority layer on: buildings fade from gray to category colours |
| 10–17 s | Fly to the #1-ranked building; selection beacon |
| 17–24 s | Building panel opens (Overview tab) while the camera orbits |
| 24–30 s | Satellite-movement layer and its legend appear; overview shot |

Recording tips: use a 1440×900 or 1920×1080 window, and let the page sit for a few seconds so tiles are cached.
Clicking, dragging or scrolling the map, or pressing `Esc`, stops the sequence.

## Building data preparation

`scripts/prepare-buildings.mjs`:

1. Downloads [NYC Building Footprints](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue) inside the
   demo bounding box (`-74.022, 40.700, -73.970, 40.735`) and [MapPLUTO](https://data.cityofnewyork.us/d/64uk-42ks)
   addresses. Responses are cached in `.cache/`. Use `--refresh` to download again, or `--input file.geojson` to read
   a local export.
2. Stores BIN as a string and drops DOB placeholder BINs.
3. Keeps `bin`, `address`, `height_m` and `year_built` only. For a BIN with several parts, the largest part is kept.
4. Converts `height_roof` from feet to metres.
5. Simplifies outlines with Douglas–Peucker (0.25 m tolerance) and rounds coordinates to 6 decimals.

## Project structure

```
frontend/
├── public/data/            buildings-demo.geojson, mock-predictions.json
├── scripts/                prepare-buildings.mjs, generate-mock-predictions.mjs
└── src/
    ├── components/         MapScene, BuildingPanel (tabs), LayerControls, RiskLegend (filters),
    │                       Shortlist (+ SearchBox), MovementLegend, ModelCard, DemoController
    ├── data/               loadBuildings, loadPredictions (validation + ML adapter), joinByBin,
    │                       priority, shortlist (search, CSV, assignment status)
    ├── layers/             buildingRiskLayer (GeoJsonLayer), movementHexagonLayer (HexagonLayer)
    ├── types/predictions.ts
    ├── camera.ts
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
- `mock-predictions.json` is **synthetic**. Its addresses and BINs are real; every score, factor, record and movement
  value was generated by `scripts/generate-mock-predictions.mjs`.

**References (no code copied)**

- [MapLibre 3D buildings example](https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/)
- [deck.gl HexagonLayer docs](https://deck.gl/docs/api-reference/aggregation-layers/hexagon-layer)
- [react-visgl-maplibre starter](https://github.com/Trapar-waves/react-visgl-maplibre) (MIT), for the overlay integration pattern
- [manhattan-3d](https://github.com/anchitjaincfa/manhattan-3d), for performance and visual reference only, because its licence is unconfirmed

## Real predictions from IBM LinuxONE and live recalculation

The app now loads predictions from the first source that works:
1. **Live ML API**: `GET {VITE_API_URL}/predictions` (default `http://localhost:8000`). The FastAPI service in `ml/`
   runs on the team's IBM LinuxONE VM and is reached through an SSH tunnel
   (`ssh -N -L 8000:127.0.0.1:8000 linux1@<vm>`; see `ml/deploy/linuxone/RUNBOOK.md`).
2. **Exported snapshot**: `public/data/linuxone-predictions.json`, written on the VM by
   `python -m urban_sentinel.export_frontend`, so recordings don't depend on the tunnel.
3. **Mock data**, still badged "Mock data", only if neither of the above loads.

The header badge shows where predictions were computed: `scored_on.machine` from the export, e.g. "IBM LinuxONE (s390x)".

**Recalculate on IBM Z** (building panel → Overview) calls `POST /score/{bin}`. The server rebuilds that building's
features and scores it live. The panel shows:
- the engine: `snapml-nnpa` (IBM Z on-chip AI accelerator via IBM Snap ML) or `xgboost` (CPU);
- the probability;
- the model inference time and the end-to-end time;
- the machine.

"Compare with CPU" re-scores the building on XGBoost to show the two engines agree.

**Satellite movement** in real mode uses only measured NASA OPERA DISP-S1 velocities, from
`GET /layers/ground-motion.geojson` or `public/data/insar-ground-motion.geojson`. If neither is present, the layer stays
disabled; no synthetic points are generated. It is a visualization layer only: ground motion did not improve the model
(`ml/reports/INSAR_ABLATION.md`).
