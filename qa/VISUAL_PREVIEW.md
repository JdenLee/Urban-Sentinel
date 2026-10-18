# Urban Sentinel visual preview

This is an isolated visual polish proposal for the three-minute Urban Sentinel demonstration. The latest pass replaces the initial dark, glowing panels with a quiet field-map interface while retaining the cinematic camera sequence.

## Checkout and base

- Checkout: `/Users/aaron/Desktop/VScode/IBM Datathon/megatron-codex-visuals`
- Branch: `codex/visual-polish`
- Base: PR #6 (`feature/building-history-frontend`), commit `0f924a9f241b0bffd296fa5ca86ecc60977ba8ab`.
- Local preview: `http://127.0.0.1:4180/`

No team checkout, API implementation, ML pipeline, score contract, or deployment was changed. This branch is local and has not been merged or deployed.

## Exact file scope

| File | Change |
| --- | --- |
| `frontend/src/components/CinematicOverlay.tsx` | Animate only the selected beacon; pause it when hidden or reduced motion is requested. |
| `frontend/src/components/MapScene.tsx` | Stable city layers and directional lighting. |
| `frontend/src/components/AppHeader.tsx` | Urban Sentinel wordmark, parcel symbol, region line, compact mobile header, and data-panel entry point. |
| `frontend/src/components/ModelCard.tsx` | Source location and runtime provenance, an accessible dialog title, and literal training-cycle labels. |
| `frontend/src/components/LayerControls.tsx` | Compact controls, explanatory accessible labels, and a consistent demo button. |
| `frontend/index.html` | Project title, theme colour, and matching parcel favicon. |
| `frontend/src/App.tsx` | Search all loaded landmark footprints and frame tall buildings with room for their spires. |
| `frontend/src/components/BuildingPanel.tsx` | Landmark titles, addresses, sources, and clear unscored/history-unavailable states. |
| `frontend/src/components/Shortlist.tsx` | Named landmark search and shortlist display. |
| `frontend/src/data/shortlist.ts` | Merge landmark results without duplicate BINs. |
| `frontend/src/data/landmarks.ts` | Seven verified landmark identities; presentation metadata only. |
| `frontend/src/data/landmarkGeometry.ts` | Lightweight illustrative One WTC shape, façade bands, and spire. |
| `frontend/src/data/landmarks.test.ts` | Identity, missing-score, search, geometry, and selection regression checks. |
| `frontend/src/layers/BuildingFacadeExtension.ts` | GPU window-bay pattern that fades in at close zoom. |
| `frontend/src/layers/landmarkLayer.ts` | Landmark geometry and labels with collision handling; anchors inside labels and expanded collision bounds reduce overlap. |
| `frontend/src/data/basemapStyle.ts` | Suppress duplicate basemap buildings so scored roofs and walls remain visible. |
| `frontend/src/data/basemapStyle.test.ts` | Regression checks for building occlusion and preserving other map layers. |
| `frontend/src/components/DemoController.tsx` | Gentler 30-second camera sequence, responsive framing, CSS progress animation, and one-second React clock updates. |
| `frontend/src/layers/buildingRiskLayer.ts` | Smaller, softer selection beacon. |
| `frontend/src/visual-polish.css` | Warm neutral panels, serif wordmark, compact legend, flat controls, fine rules, readable scores, responsive layout, and restrained motion. |
| `frontend/src/main.tsx` | Load the isolated visual stylesheet after existing styles. |
| `frontend/package.json`, `frontend/package-lock.json` | Add `@deck.gl/extensions` 9.4.0 (matching the installed deck.gl version) for label collision handling. |
| `qa/VISUAL_PREVIEW.md` | Scope and validation notes. |

The automatic finale returns to the priority overview. Satellite movement remains manually available; it is not forced on by the camera script. The risk palette and numeric scores are unchanged.

## Preview data and launch

The preview uses the existing local prediction export copied to the ignored file `frontend/public/data/qa-preview.json`. That export reports `arm64`, not LinuxONE. The sidebar footer and Data & model dialog preserve that provenance. It is not committed and is not a production fixture. The live API points to a deliberately unavailable local path, so history/live inference is not being validated here. Basemap tiles still require network access.

```sh
cd frontend
VITE_API_URL=/qa-offline VITE_PREDICTIONS_URL=/data/qa-preview.json npm run dev -- --host 127.0.0.1 --port 4180 --strictPort
```

## Validation

- Frontend suite: 46 tests passed, including basemap and landmark regression checks.
- TypeScript and Vite production build passed.
- Browser preview at 1280 × 720: completed the 30-second sequence, reopened the selected building, restarted the demo, stopped with Escape, and used Reset View.
- No browser error/warning logs observed during these checks.
- Visually checked lighting, selection, panel readability, and the selected-building controls.
- Corrected duplicate building occlusion after the user's screenshot exposed it. The old inverted `within` filter did not exclude building polygons; MapLibre's installed implementation only evaluates points and lines. Removed the extra generic gray extrusions and hid any basemap building/extrusion layers. The BIN-linked scored and unscored deck.gl geometry is the sole 3D building source. Browser comparison of 709 F D R DRIVE and adjacent buildings confirmed full colored walls and roofs afterward.
- Reduced motion and hidden-tab handling are implemented; OS preference switching was not exercised.
- Performance claim is limited to removing per-frame React state updates and full city-layer object recreation. No FPS benchmark was run.

## Integration considerations

This proposal overlaps frontend presentation files in PR #6, so integrate it only after the frontend owner reviews the diff against their latest head. It deliberately keeps API/data changes out of the patch.

Release QA findings remain separate: priority thresholds versus percentile categories, shortlist/map capacity alignment, request timeouts, and verification against the final LinuxONE export. The training-label display now preserves `FISP cycle 9` literally instead of parsing it as a date; this correction remains local until integrated. A visual preview is not evidence the other release gates have passed.

Coverage remains the existing Lower Manhattan demo bounding box. Broader map coverage requires more prepared footprints and matching prediction exports; no geographic expansion is included. Removing duplicate basemap extrusions also leaves areas outside the prepared scene as a flat basemap unless an individual searched footprint is loaded.

## Landmark and close-up detail follow-up

Names are keyed to footprint BINs for One World Trade Center, 7 World Trade Center, Woolworth Building, New York City Hall, The Trump Building (40 Wall Street), 70 Pine Street, and 8 Spruce / New York by Gehry. Names and aliases work in search; tooltip, panel, and shortlist titles use the same lookup. Original addresses, predictions, ranks, and ML inputs remain unchanged. Sources for each display identity are linked in `landmarks.ts` and the building panel.

The initial map extruded one simplified footprint to a single roof height. It contained no actual façade, roof equipment, taper, crown, or spire model. Close-up window bays are now drawn on the GPU and fade in with zoom; they are illustrative rather than measured windows. One WTC has a separate approximate model with a cubic base, eight triangular faces, a rotated roof, and spire. Its form follows [SOM's project description](https://www.som.com/projects/one-world-trade-center/); roof/spire heights are approximately 417.1 / 541.3 metres. This is not a photogrammetric, engineering, or as-built model. Other landmarks retain their original extruded geometry.

### Why One WTC is unscored in this preview

- Prepared footprint: BIN `1088469`, parcel-derived address `185 Greenwich Street`, source roof height 429.3 m.
- The local `data/outputs/buildings_scores.json` (model `7466a264b5ba6762`, generated 2026-10-17 22:30 UTC) has zero records for that BIN, across 16,512 building records.
- The cached `data/raw/facades.csv.gz` also has zero filings for that BIN. This is a data-coverage finding, not a finding about inspection obligations, building safety, or why records are absent upstream.
- The current ML code builds its universe from FISP records and predicts pending buildings. No prediction was invented to color a famous building.
- The panel now explicitly explains an absent score and distinguishes it from low risk. Unscored One WTC stays neutral silver-gray; selection outlines it in cyan.

Browser checks include finding One WTC with the `Freedom Tower` and `One WTC` aliases, displaying the unscored notice, finding Woolworth by name with its existing 0.3706 probability, and observing window bays on scored buildings at close zoom. Clicking the custom One WTC model opens BIN `1088469`, confirming that its faces resolve to the original building record. The final 30-second demo completed with the new layers, returned to the inspection overview, and produced no browser warnings or errors. Shader updates required a fresh page load during development; these final checks used a clean reload. This is still a local preview, not live LinuxONE/history validation or an FPS benchmark.

## Original identity and clean interface follow-up

The user requested a less generic interface. The current design uses a custom parcel mark, Urban Sentinel wordmark, New York City / Lower Manhattan region line, warm paper surfaces, and restrained forest-green controls. The previous glowing runtime/source pills are replaced by a single Data & model entry point. The dialog retains the actual source, URL, model version, execution platform, training window, timestamps, validation, and limitations. Mock mode remains explicitly marked in the header.

The compact two-column priority legend leaves more room for the inspection shortlist. Building scores use dark tabular numerals with their original priority colour in the adjacent category tag and bar. Tabs, lists, notices, tooltips, and map controls use the same simple rules and small corner radii. No fonts, image assets, or new packages were added in this pass.

Verified the desktop layout at 1280 × 720 and the mobile layout at 390 × 844, including drawer open/close, landmark search, automatic drawer closure on selection, and the building detail sheet. The narrow header stays on one row. The Data & model dialog displays the original `arm64` provenance and `FISP cycle 9` training label. The browser viewport was restored after testing.
