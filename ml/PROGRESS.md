# ML workstream — running progress note

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
