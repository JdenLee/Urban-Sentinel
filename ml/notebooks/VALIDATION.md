# Local verification · 2026-10-18 UTC

This is **local macOS arm64 verification**, not LinuxONE execution evidence.
Python 3.12.14; pinned IBM-compatible NumPy 2.0.2 / pandas 3.0.6 /
scikit-learn 1.9.0 / XGBoost 3.4.1. OpenMP was installed for local XGBoost.

## Executed

- Downloaded all municipal sources into a fresh, ignored presentation directory.
  Source receipt completed 2026-10-18T03:26:52Z. Subsequent fresh-kernel runs
  reused that same SHA-256-verified snapshot; downstream stages did not change it.
- Executed all 16 notebook code cells from a fresh kernel: preparation, cutoff
  checks, evaluation/bootstrap, training, scoring, all six figures and live inference.
  No error outputs. Repeated rebuilds produced model `96fdbd6307d54bdd`.
- Cleaning: 87,455 raw filing rows, 56 invalid/placeholder BIN rows removed,
  one invalid cycle removed, 87,398 retained, 32 without an observable date,
  16,903 distinct BINs. Date coverage retains the missing records explicitly.
- Matching top-500 cohort: 12,116 buildings; Urban Sentinel 66.6%, last-status
  rule 55.4%, DOB 2022 benchmark 40.2%. Primary holdout/calibration: 13,327;
  previously-SAFE subgroup: 4,253, with top-250 precision 37.6% vs 20.4%.
  Charts use the JSON artifacts, not these documentation values.
- Cutoff checks: 25 real buildings, 62 history/event columns, removing future
  records and changing future outcomes. PLUTO/lot-link snapshot caveat remains.
- Selected highest-ranked pending building with SAFE on record: rank 366,
  probability approximately 0.728. Actual engine was XGBoost, with an explicit
  `not IBM Z (arm64)` NNPA fallback. Timing is measured each execution, not fixed.
- HTML export and figure inspection; 1280×720 browser viewport, no horizontal
  page overflow. Presentation-sized charts, readable labels and separate appendix.
  Source notebook has no outputs; executed notebook/HTML/figures stay gitignored.
- `PYTHONPATH=ml .venv/bin/python -m pytest ml/tests -q`: 45 tests passed.
  Includes dependency/native-library failure, unavailable network, snapshot
  tampering, cohort/cutoff/calibration/probability invariants, SAFE fallback,
  unavailable NNPA (arm64 and simulated s390x without zDNN), disabled satellite,
  missing credentials/compiled dependencies, safe subprocess failure, isolated
  output paths, partial-output refusal and cached satellite municipal readers.
- Python compilation, notebook schema validation and `git diff --check` passed.

## Diagnostics and boundaries

The local baseline fitting emitted NumPy/scikit-learn matrix multiplication
RuntimeWarnings (divide-by-zero, overflow, invalid). They are counted in notebook
setup and retained under run-local `reports/*_warnings.json`, not silently hidden.
Displayed metrics/calibration and scored probabilities passed finite/range/cohort
checks, and repeated runs reproduced the model ID and comparison results. Review
warnings again on LinuxONE; this is not a claim of warning-free numerical execution.
The existing API tests also emit a Starlette/httpx deprecation warning.

Authenticated OPERA reconstruction was **not executed**: no Earthdata credentials
or separate geospatial interpreter were configured here. Orchestration and cache
readers were tested, but actual downloads, geospatial extraction/quality plots and
fresh satellite ablation remain unverified. Saved measured observations and saved
ablation are labeled as such; missing historical execution metadata is not invented.

LinuxONE execution and NNPA hardware performance remain **team acceptance steps**.
Follow README.md on the instance, preserve the new run manifest and actual engine,
and record only after Run All succeeds. No PR merge, deployment, frontend update
or prediction API contract change is part of this delivery.
