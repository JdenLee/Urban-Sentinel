# NYC inspection explorer redesign

The map is the default workspace. Search remains visible; operational controls live in an expandable drawer. A selected building opens Summary, Why this score?, and History.

## Run locally

From the repository's `frontend` directory:

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

Open http://127.0.0.1:5173/. The committed LinuxONE prediction snapshot keeps the map usable without the live service. A failed history request is explicitly labeled; only records actually contained in the snapshot are replayed.

Validation: `npm run build`, `npm test`.

## Interaction and interpretation

- Desktop: left-drag in Orbit mode rotates/tilts; Pan mode moves the map. Scroll zooms. 2D, 3D, North, and Reset are explicit controls. Touch pointers retain native pan/zoom/rotate.
- Selecting a priority closes the drawer and frames the building clear of the details panel. Search and shortlist use completed clicks, preventing pointer-down removal from interrupting the camera flight.
- Summary shows a percentage only when the exported score is a probability. Contributions preserve signed log-odds units; they are not percentage-point changes or causal claims.
- The model is an XGBoost ensemble. The process illustration explains the ensemble and calibration; it does not pretend to show actual tree paths. The existing export contains only feature contributions.
- History has Play/Pause, speed, keyboard-accessible date scrubbing, latest dated event, cumulative record counts, and measured displacement when present. Dates are actual observation steps, not uniformly spaced simulation time. Later records and satellite observations are excluded at earlier steps. Present-day geometry and current predictions never change to invented historical values.
- Satellite displacement remains contextual, not a deployed model predictor. Synthetic records/measurements are labeled when mock data supplies them.
- Required OpenMapTiles/OpenStreetMap credits remain. Only optional OpenFreeMap branding is hidden. Street, POI, and persistent landmark labels are removed; names/addresses remain searchable and available on selection.

## Geometry

One World Trade Center retains its existing illustrative faceted model. Woolworth and 40 Wall Street now have illustrative stepped silhouettes/crowns anchored to their BIN-linked footprints. Architectural heights reference the [Skyscraper Museum's Woolworth history](https://www.skyscraper.org/programs/the-woolworth-building-engineering-height/) and [40 Wall Street history](https://www.skyscraper.org/tallest-towers/40-wall-street/). Tier widths, setbacks, crowns, and procedural façade details are approximations, not surveyed meshes or exact reproductions.

The preparation pipeline now retains multiple footprint components with their individual roof heights if the municipal source supplies them; model/search records remain unique by BIN. The refreshed Lower Manhattan source currently has 10,291 retained buildings and **no duplicate-BIN components**, so this compatibility improvement does not itself add roof detail to the current ordinary buildings. Three existing building records changed on refresh. No model artifacts or predictions were modified.

Survey-grade rooflines and architectural detail for every building still require an additional LoD2/mesh dataset and reconciliation with the present-day BIN inventory. Area-wide replay likewise requires an area-wide historical export; the implemented replay is for the selected building.

## Verification (local, 2026-10-18)

- Production build and TypeScript validation pass.
- 92 unit tests pass after rebasing onto the latest `main` (including the image-carousel update), covering date validation, future-record exclusion, non-mutating playback, part-height preservation, stable BIN joins, landmark bounds, hidden labels, blue water, and retained attribution.
- Browser checks before that rebase at 1280×720 and 390×844: layout, orbit without accidental selection, 2D/reset, shortlist camera flight, percentage panel, and real saved-history playback. The rebase was conflict-free; the build and tests were rerun afterward, but the new carousel was not browser-retested as part of this redesign.
- Live history was unavailable locally; fallback labeling and saved filings were checked. No claim of LinuxONE execution or live NNPA verification is made.
- Simulated unavailable basemap: visible buildings and an actionable error notice remain, with no new rendering errors on a fresh load.
- Full-page reload after editing the renderer avoids development hot-reload reuse of finalized deck.gl layers. Fresh-load smoke tests passed.
- Actual touchscreen hardware, screen-reader software, and low-powered-device frame rates have not been tested.

To reproduce the basemap-failure check in a second terminal:

```sh
VITE_BASEMAP_STYLE_URL=http://127.0.0.1:9/missing-style.json npm run dev -- --host 127.0.0.1 --port 5174
```

## Security follow-up

`npm audit --omit=dev` reports the existing MapLibre sanitizer advisory [GHSA-jrc7-96c5-q579](https://github.com/advisories/GHSA-jrc7-96c5-q579), rated critical. The reported fix requires a MapLibre major-version upgrade; it was not silently bundled into the visual redesign. Review/upgrade the mapping dependency before public deployment. The complete audit also reports existing development-dependency findings.

## Explicit follow-ups

1. Obtain/reconcile surveyed LoD2 building meshes; do not present illustrative silhouettes as exact geometry.
2. Add an authenticated backend tree-path export (tree ID, split values, missing-value branch, leaf contribution and calibration metadata) before implementing a literal per-tree decision inspector.
3. Add compact dated citywide records before extending replay beyond the selected building.
4. Review the MapLibre major-version security upgrade separately, then repeat rendering and interaction tests.
