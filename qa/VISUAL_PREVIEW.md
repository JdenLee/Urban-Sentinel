# Cinematic frontend preview

This is an isolated visual polish proposal for the three-minute Urban Sentinel demonstration.

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
| `frontend/src/components/DemoController.tsx` | Gentler 30-second camera sequence, responsive framing, CSS progress animation, and one-second React clock updates. |
| `frontend/src/layers/buildingRiskLayer.ts` | Smaller, softer selection beacon. |
| `frontend/src/visual-polish.css` | Panel contrast, typography, restrained glow, transitions, and control placement. |
| `frontend/src/main.tsx` | Load the isolated visual stylesheet after existing styles. |
| `qa/VISUAL_PREVIEW.md` | Scope and validation notes. |

The automatic finale returns to the priority overview. Satellite movement remains manually available; it is not forced on by the camera script. The risk palette and numeric scores are unchanged.

## Preview data and launch

The preview uses the existing local prediction export copied to the ignored file `frontend/public/data/qa-preview.json`. That export reports `arm64`, not LinuxONE. The header preserves that provenance. It is not committed and is not a production fixture. The live API points to a deliberately unavailable local path, so history/live inference is not being validated here. Basemap tiles still require network access.

```sh
cd frontend
VITE_API_URL=/qa-offline VITE_PREDICTIONS_URL=/data/qa-preview.json npm run dev -- --host 127.0.0.1 --port 4180 --strictPort
```

## Validation

- Existing frontend suite: 39 tests passed.
- TypeScript and Vite production build passed.
- Browser preview at 1280 × 720: completed the 30-second sequence, reopened the selected building, restarted the demo, stopped with Escape, and used Reset View.
- No browser error/warning logs observed during these checks.
- Visually checked lighting, selection, panel readability, and the selected-building controls.
- Reduced motion and hidden-tab handling are implemented; OS preference switching was not exercised.
- Performance claim is limited to removing per-frame React state updates and full city-layer object recreation. No FPS benchmark was run.

## Integration considerations

This proposal overlaps frontend presentation files in PR #6, so integrate it only after the frontend owner reviews the diff against their latest head. It deliberately keeps API/data changes out of the patch.

Release QA findings remain separate: priority thresholds versus percentile categories, shortlist/map capacity alignment, the invalid trained-through date, request timeouts, and verification against the final LinuxONE export. A visual preview is not evidence those release gates have passed.
