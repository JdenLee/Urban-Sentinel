# Urban Sentinel — façade outcome model (`ml/`)

Predicts, for each building in NYC's Façade Inspection & Safety Program (FISP, Local Law 11), the probability that
its **next Initial FISP filing records an UNSAFE façade condition**, using only records available before the
decision date. It is a prioritisation aid for proactive inspection, **not** a structural-safety or collapse
prediction.

## Quick start (local)
```bash
python3.12 -m venv .venv && .venv/bin/pip install -r ml/requirements.txt
cd ml
../.venv/bin/python -m pytest tests -q                  # label rules + leakage guards
../.venv/bin/python -m urban_sentinel.experiments       # downloads data to ../data/raw, writes reports/
../.venv/bin/python -m urban_sentinel.audit_leakage     # why the penalty fields are excluded
```
Raw caches (`data/raw/*.csv.gz`) and trained models (`data/models/`) are gitignored; `reports/` holds the small
committed evaluation outputs. LinuxONE instructions: `deploy/linuxone/RUNBOOK.md`.

## Outcome definition
- **Unit:** building (BIN) × decision date (cutoff).
- **Label:** `y = 1` if the worst status among the building's Initial filings in the target cycle is UNSAFE; 0 for SAFE or
  SWARMP. Source: `filing_status` in [DOB NOW: Safety – Facades Compliance Filings](https://data.cityofnewyork.us/d/xubg-57si).
- **Eligible:** buildings that filed a classified Initial report in the cycle. Buildings that never filed have no label. They
  are counted in the reports because their absence is not random.

## Point-in-time controls
- Every record gets an `observed_on` date: the later of `submitted_on` and `filing_date`. Auto-generated
  No-Report-Filed rows use their sub-cycle deadline.
- Features use only records observed **before** the cutoff, from cycles **before** the target. `features.build_features`
  raises `LeakageError` otherwise, and tests check that the features don't change when post-cutoff records are added.
- Excluded because they change after filing: `current_status`, the target row's `prior_status`, the per-row penalty
  amounts and `comments`.
  - `audit_leakage` shows the penalty amounts alone would raise cycle-9 PR-AUC from 0.379 to 0.552.
- Filing timing carries information, because sub-cycles are set by block-number digit and file in different years.
  - **Primary test:** cycle 9, which is complete.
  - **Cycle 10 to date:** heavily self-selected. 77% of early filers had No Report Filed in cycle 9.

## Results
See `reports/RESULTS.md` (full tables and bootstrap CIs) and `PROGRESS.md` (summary).

## Data sources
NYC Open Data (DOB façade filings). The benchmark is NYC DOB's published façade risk scores
(github.com/NYCDOB/FacadeRisk, 2022 snapshot). It declares no license, so it is fetched at runtime for comparison and
never redistributed.

Libraries: pandas, NumPy, scikit-learn, XGBoost.
