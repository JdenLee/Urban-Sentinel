# ML workstream — running progress note

## 2026-10-17 18:35 EDT — InSAR ablation: null result (not added to the model)

- **Data** (`ml/insar/`, see its README and QUALITY_REPORT):
  - NASA OPERA DISP-S1, frame F08622: 97 epochs from 2016-09 to 2020-02, all before the cycle-9 cutoff.
  - Fetched as about 2 GB of remote byte-range subsets instead of about 41 GB of granules.
  - 89% of land pixels pass quality checks. 99.1% of FISP buildings have features.
  - Sanity check passes: Arthur Ashe Stadium −3.1 mm/yr vs −3.0 published.
- **Ablation** (`reports/INSAR_ABLATION.md`). Motion features only (ramp-free velocity, local differential motion,
  acceleration, seasonal amplitude, spread), winsorised:
  - A, train 7–8 → test 9 (training rows see post-cutoff motion): PR-AUC 0.454 → 0.452 (Δ −0.002, CI −0.006 to
    +0.002).
  - **B, clean: cycle-9 5-fold CV grouped by tax block:** PR-AUC 0.457 → 0.459 (Δ +0.001, CI −0.004 to +0.006).
  - The previously-SAFE subgroup shows no gain in either design.
- **Conclusion.** At building scale, 2016–2020 ground motion adds nothing beyond municipal records. This is
  consistent with about 1–2 mm/yr motion and 30 m pixels. It is kept out of the deployed model and can be used as a
  visualization layer only, with no structural-safety inference.

## 2026-10-17 17:30 EDT — NNPA verified (Snap ML), not yet deployed

- On the VM: the CPU advertises `nnpa`, and zDNN 1.1.2 returns `zdnn_is_nnpa_installed()=true`.
- Snap ML 1.17.2 imports the model after a legacy JSON rewrite: XGBoost 3.4's JSON trips its parser.
- The deployed model diverges in Snap ML only on rows with missing values. The 82 complete rows match to 2e-7.
- A sentinel-encoded variant has the same accuracy (same-vantage backtest PR-AUC 0.468 vs 0.465). On
  `zdnn_tensors` (NNPA) it **matches XGBoost to within 3.8e-7 on all 13,650 buildings**, with an identical top 500.
- Timings:
  - Single row: NNPA 0.022 ms vs XGBoost 0.087 ms.
  - Batch: NNPA 134 ms vs XGBoost 49 ms (NNPA is slower for batch).
  - **Claim verified NNPA inference with exact agreement, not overall speed.**

## 2026-10-17 16:05 EDT — verified on IBM LinuxONE (s390x, RHEL 9.8, Podman)

The full pipeline ran **inside IBM's `jupyterlab-image-s390x` container** on the team VM. Evidence is in
`reports/linuxone/` (`run_manifest_s390x.json`, `RESULTS.md`). The VM run used today's data.

- **Platform:** `machine: s390x`, `byteorder: big`, `Linux-5.14.0-687.58.1.el9_8.s390x`, Python 3.12.15. Packages
  are identical to the local pins (numpy 2.0.2, pandas 3.0.6, scikit-learn 1.9.0, xgboost 3.4.1).
- **Tests on the VM:** 8 passed, including the cross-architecture parity test ("parity on big-endian vs fixture from
  arm64").
- **Evaluation on s390x** (226 s):
  - Cycle-9 PR-AUC 0.451 vs rule 0.358 (+0.092, CI +0.079 to +0.105).
  - P@500 0.660 vs 0.560.
  - This matches the laptop run (0.454) within data-refresh noise.
- **Training + scoring on s390x** (39.5 s): model `f12061750b25f7a4` (242 rounds) was trained on the VM and scored
  13,650 pending buildings. Same-vantage backtest PR-AUC 0.466.
- **Live API on the VM**, bound to 127.0.0.1 and reached over an SSH tunnel:
  - `/health` returns `s390x`/`big` and 16,514 buildings.
  - `POST /score/2021985` returns probability 0.756 with per-feature TreeSHAP contributions. `inference_ms` is 97 on
    s390x.
- **CPU features include `nnpa`**, IBM Z's on-chip AI accelerator. **It is not used yet**, so we claim nothing about
  acceleration. A possible stretch goal is Snap ML NNPA inference, but only with verified `zdnn_tensors` evidence.

## 2026-10-17 13:20 EDT — Step 2: extra sources help; deployed model = façade + DOB + ECB + building attributes

**Ablation.** Same cycle-9 test, paired bootstrap against façade-only (`reports/ABLATION.md`):

| Variant | PR-AUC | P@500 | prev-SAFE P@250 | Δ PR-AUC (95% CI) |
|---|---|---|---|---|
| Façade only | 0.379 | 0.522 | 0.324 | — |
| + DOB violations | 0.417 | 0.618 | 0.296 | +0.039 (+0.030, +0.049) |
| + ECB violations | 0.388 | 0.572 | 0.344 | +0.010 (+0.003, +0.016) |
| + complaints | 0.377 | 0.522 | 0.296 | −0.002 (n.s.), **dropped** |
| + building attributes (PLUTO) | 0.418 | 0.622 | 0.356 | +0.040 (+0.029, +0.050) |
| + DOB + ECB (no PLUTO snapshot) | 0.424 | 0.610 | 0.324 | +0.045 (+0.035, +0.054) |
| **+ DOB + ECB + building (deployed)** | **0.454** | **0.662** | **0.384** | **+0.075 (+0.064, +0.087)** |

- The "echo" sensitivity check gives 0.448: dropping label-echo codes within 90 days of the cutoff changes nothing.

**Headline results (cycle 9, n=13,327, base 0.250):**
- **Deployed model PR-AUC 0.454 vs rule 0.358** (+0.096, CI +0.083 to +0.108).
- **P@500 0.662 vs rule 0.560** (+0.102, CI +0.050 to +0.148).
- **Previously-SAFE subgroup** (n=4,253, base 0.183):
  - PR-AUC 0.289 vs rule 0.205 (+0.084, CI +0.062 to +0.110).
  - **Top 250 are 38.4% newly UNSAFE (2.1× base).** Most of that lift comes from building attributes plus DOB history.
- **No prior FISP filing** (n=1,441): PR-AUC 0.321 vs base 0.173.
- **vs DOB's published 2022 score on identical buildings (cycle 9):** PR-AUC 0.461 vs 0.341, P@500 0.660 vs 0.402.
  - This setting *favors DOB*, whose model may have seen cycle-9 outcomes.
- **Matched information date** (2022-03-17 → cycle-10 filers): 0.668 vs DOB 0.414.
  - **Inflated by selection.** Non-compliance features predict who appears among the early cycle-10 filers (77%
    skipped cycle 9). Cycle 9 is the number to quote.
- **Calibration:** switched to Platt scaling, because isotonic plateaued at p=1.0 and tied the top ranks. Cycle-9 ECE
  0.036; mean predicted 0.256 vs observed 0.250.
- **Same-vantage backtest** for the live model: PR-AUC 0.466 vs rule 0.363 (n=11,643 buildings pending 1.65 years
  into cycle 9).

**Caveats:**
- PLUTO is a 2026 snapshot. Lot area and building class are near-static, but they are not true point-in-time values.
  The PLUTO-free variant still gains +0.045.
- `lot_area` partly flags large multi-building developments.

## 2026-10-17 13:05 EDT — integration layer ready (scores + API + contract + LinuxONE runbook)

**Works.**
- `python -m urban_sentinel.pipeline` runs evaluate → train at today's vantage → score in one command.
- `uvicorn urban_sentinel.serve:app` serves the results.
- 8 tests pass, including a **cross-architecture parity test**: 20 frozen predictions must reproduce within 1e-6 on
  big-endian s390x.

**Deployed model is vantage-matched.** Live scores are made 1.65 years into cycle 10 for buildings that haven't filed
yet. So the model is trained on the same situation in cycles 7–9: cutoff = cycle start + the same elapsed time,
restricted to buildings still pending then.
- Same-vantage backtest on cycle 9 (n=11,643 pending, base 0.247): **XGBoost PR-AUC 0.421 vs rule 0.363.**

**Outputs.**
- 16,512 FISP buildings.
- 13,659 pending buildings scored, with tiers by rank percentile: high 682, elevated 2,049.
- 2,853 have already filed cycle 10 and carry their recorded status instead of a prediction.
- 356 lack a PLUTO location.

**API endpoints:**
- `/health`: platform fingerprint, so it shows `s390x`/`big` on LinuxONE.
- `/buildings/{bin}`.
- `/top?mode=unknown_risk`: excludes buildings already on record as UNSAFE.
- `/buildings.geojson`.
- `POST /score/{bin}`: live on-server inference, about 35 ms.
- `POST /rescore`: token-protected; refreshes Open Data and retrains.

**Contract for the frontend.** `contract/building_score.schema.json` plus `contract/sample_buildings.json` (20
records), keyed by BIN with PLUTO lat/lon.

**Needs from team:**
- Aaron: run `deploy/linuxone/RUNBOOK.md` steps 0–6 on the VM and paste the outputs back.
- Frontend owner: confirm the contract.

## 2026-10-17 12:45 EDT — Step 1 (façade history only, strict point-in-time)

**Works.** The pipeline runs end to end locally: cached Socrata ingest → labels → point-in-time features → baselines and
XGBoost → chronological evaluation → portable model artifacts. Six unit tests cover label rules, the leakage guard and
invariance to post-cutoff records.

**Tested how.** Train on cycles 7–8 with cutoffs 2010-02-21 and 2015-02-21, test on all of cycle 9 (cutoff 2020-02-21,
13,327 buildings, 25% UNSAFE). Paired bootstrap, 1,000 resamples. Full tables are in `reports/RESULTS.md`.

### Findings
| Cycle-9 test (n=13,327, base 0.250) | PR-AUC | P@250 | P@500 |
|---|---|---|---|
| Previous-status rule | 0.358 | 0.628 | 0.560 |
| Logistic regression on history | **0.389** | 0.636 | **0.582** |
| XGBoost (façade history) | 0.379 | 0.520 | 0.522 |

1. **The preliminary result was inflated by leakage.** The per-row penalty amounts have no posting date. Adding them
   lifts PR-AUC from 0.379 to 0.552 (`reports/leakage_audit.json`), so they are excluded.
2. **Façade history alone gives only modest gains over "last status".**
   - XGBoost beats the rule on PR-AUC (+0.020, CI +0.008 to +0.033), but not at the top-500 capacity.
   - Logistic regression is as good as or better than XGBoost.
   - Calibration is good: ECE 0.023, mean predicted 0.260 vs observed 0.250.
   - For ranking, use the raw score: isotonic plateaus hurt top-k ordering.
3. **Newly unsafe (Concern 1).** In previously-SAFE buildings (n=4,253, base 0.183):
   - XGBoost's top 250 contain **32.4% newly UNSAFE** (1.8× the base rate), versus 25.2% for logistic and about the
     base rate for the rule.
   - The rule is tied within this group, so compare it to the base rate.
   - PR-AUC gain over the rule is small (+0.022, CI +0.002 to +0.044).
   - **Honest framing: there is a real but modest ability to surface newly unsafe façades from history alone.** More
     sources are needed (Step 2).
4. **DOB benchmark (Concern 3), on identical buildings:**
   - **Cycle 9** (n=12,116; DOB possibly in-sample): XGBoost 0.390 vs DOB 0.341 PR-AUC.
   - **Matched information date 2022-03-17 → cycle-10 filers** (n=2,400): XGBoost 0.487 vs DOB 0.414 (+0.073, CI
     +0.032 to +0.113).
   - **The plain previous-status rule also beats DOB** (0.461).
   - Caveat: DOB's stated target is broader (violations, accidents).
5. **Cycle 10 to date is heavily selected.**
   - 76.9% of early cycle-10 filers had No Report Filed in cycle 9 (vs 34.1% normally). Their UNSAFE rate is 0.297
     against 0.114 without them.
   - The impressive cycle-10 numbers (PR-AUC 0.65) mostly reflect that subgroup.
   - The representative slice (sub-cycle A, no prior NRF) has n=469 and 27 positives, too few to conclude anything.
6. **Never-filers.** 3,071 cycle-9 never-filers vs 13,327 labeled. They have far more "no history" (36% vs 11%), so
   the labeled population under-represents delinquent and new buildings.

### Next highest-value steps
1. `score` + `serve` + frontend contract + LinuxONE runbook, so integration can start.
2. Step 2 ablations: DOB violations, ECB wall-maintenance violations, complaints, and PLUTO/footprint attributes, each
   kept only if it improves the cycle-9 result (overall and previously-SAFE) outside the CI.

### Blockers / needs from team
- The frontend owner should confirm a BIN-keyed contract with lat/lon.
- `podman exec notebook pip list` from the VM, to confirm pins.
