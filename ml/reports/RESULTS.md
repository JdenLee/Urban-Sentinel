# Results — UNSAFE at first Initial FISP filing of the target cycle

Run on `arm64` (macOS-15.6.1-arm64-arm-64bit), 2026-10-17T16:37:52.450614+00:00, 84.1 s

## Primary test: cycle 9 (cutoff 2020-02-21, trained on cycles 7–8)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 13327 | 0.250 | 0.358 | 0.626 | 0.628 | 0.560 | 0.502 | 0.084 |
| logistic_history | 13327 | 0.250 | 0.389 | 0.640 | 0.636 | 0.582 | 0.496 | 0.087 |
| xgboost | 13327 | 0.250 | 0.379 | 0.629 | 0.520 | 0.522 | 0.522 | 0.078 |
| xgboost_calibrated | 13327 | 0.250 | 0.365 | 0.630 | 0.500 | 0.464 | 0.493 | 0.070 |

- xgboost_minus_rule_prev_status · pr_auc: +0.020 (95% CI +0.008 to +0.033)

- xgboost_minus_rule_prev_status · precision@500: -0.038 (95% CI -0.092 to +0.016)

- xgboost_minus_logistic_history · pr_auc: -0.011 (95% CI -0.024 to +0.002)

- xgboost_minus_logistic_history · precision@500: -0.060 (95% CI -0.118 to -0.010)

## Cycle 9 subgroup: previously_safe

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 4253 | 0.183 | 0.205 | 0.555 | 0.204 | 0.198 | 0.257 | 0.127 |
| logistic_history | 4253 | 0.183 | 0.219 | 0.568 | 0.252 | 0.256 | 0.215 | 0.165 |
| xgboost | 4253 | 0.183 | 0.227 | 0.548 | 0.324 | 0.296 | 0.234 | 0.190 |
| xgboost_calibrated | 4253 | 0.183 | 0.224 | 0.544 | 0.316 | 0.296 | 0.241 | 0.190 |

- xgboost_minus_rule_prev_status · pr_auc: +0.022 (95% CI +0.002 to +0.044)

- xgboost_minus_rule_prev_status · precision@250: +0.120 (95% CI +0.008 to +0.168)

- xgboost_minus_logistic_history · pr_auc: +0.008 (95% CI -0.006 to +0.025)

- xgboost_minus_logistic_history · precision@250: +0.072 (95% CI +0.004 to +0.144)

## Cycle 9 subgroup: previously_swarmp

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 5011 | 0.242 | 0.253 | 0.525 | 0.284 | 0.280 | 0.290 | 0.115 |
| logistic_history | 5011 | 0.242 | 0.316 | 0.595 | 0.424 | 0.406 | 0.347 | 0.167 |
| xgboost | 5011 | 0.242 | 0.274 | 0.556 | 0.276 | 0.314 | 0.313 | 0.129 |
| xgboost_calibrated | 5011 | 0.242 | 0.275 | 0.562 | 0.288 | 0.314 | 0.311 | 0.129 |

- xgboost_minus_rule_prev_status · pr_auc: +0.020 (95% CI +0.007 to +0.036)

- xgboost_minus_rule_prev_status · precision@250: -0.008 (95% CI -0.092 to +0.064)

- xgboost_minus_logistic_history · pr_auc: -0.042 (95% CI -0.059 to -0.026)

- xgboost_minus_logistic_history · precision@250: -0.148 (95% CI -0.212 to -0.064)

## Cycle 9 subgroup: previously_unsafe

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 2610 | 0.418 | 0.487 | 0.594 | 0.628 | 0.560 | 0.502 | 0.257 |
| logistic_history | 2610 | 0.418 | 0.529 | 0.626 | 0.636 | 0.600 | 0.503 | 0.275 |
| xgboost | 2610 | 0.418 | 0.552 | 0.646 | 0.640 | 0.616 | 0.537 | 0.282 |
| xgboost_calibrated | 2610 | 0.418 | 0.515 | 0.629 | 0.512 | 0.484 | 0.527 | 0.222 |

- xgboost_minus_rule_prev_status · pr_auc: +0.065 (95% CI +0.036 to +0.096)

- xgboost_minus_rule_prev_status · precision@250: +0.012 (95% CI -0.072 to +0.088)

- xgboost_minus_logistic_history · pr_auc: +0.024 (95% CI -0.005 to +0.051)

- xgboost_minus_logistic_history · precision@250: +0.004 (95% CI -0.068 to +0.080)

## Cycle 9 subgroup: no_prior_filing

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 1441 | 0.173 | 0.173 | 0.500 | 0.260 | 0.184 | 0.193 | 0.369 |
| logistic_history | 1441 | 0.173 | 0.204 | 0.584 | 0.200 | 0.230 | 0.207 | 0.462 |
| xgboost | 1441 | 0.173 | 0.265 | 0.578 | 0.260 | 0.240 | 0.185 | 0.482 |
| xgboost_calibrated | 1441 | 0.173 | 0.239 | 0.577 | 0.264 | 0.246 | 0.186 | 0.494 |

- xgboost_minus_rule_prev_status · pr_auc: +0.092 (95% CI +0.052 to +0.139)

- xgboost_minus_rule_prev_status · precision@250: +0.000 (95% CI +0.024 to +0.152)

- xgboost_minus_logistic_history · pr_auc: +0.061 (95% CI +0.025 to +0.104)

- xgboost_minus_logistic_history · precision@250: +0.060 (95% CI -0.016 to +0.100)

Calibration (cycle 9, isotonic from cycle 8): Brier 0.1790, ECE 0.0229, mean predicted 0.260 vs observed 0.250

By sub-cycle (xgboost): A: PR-AUC 0.409 (base 0.264, n=5234), B: PR-AUC 0.374 (base 0.239, n=4133), C: PR-AUC 0.355 (base 0.244, n=3960)

Never-filers in cycle 9: 3071 vs 13327 labeled; last-status mix never-filers {-1.0: 0.357, 1.0: 0.227, 0.0: 0.212, 2.0: 0.204} vs labeled {1.0: 0.376, 0.0: 0.32, 2.0: 0.196, -1.0: 0.108} (-1 none, 0 SAFE, 1 SWARMP, 2 UNSAFE)

Top mean |SHAP|: status_at_cutoff 0.2809999883174896, years_since_last_filing 0.12950000166893005, wall_brick 0.09809999912977219, days_vs_deadline_last 0.06430000066757202, cycles_since_last 0.059300001710653305, last_status 0.050599999725818634, borough_code 0.04820000007748604, n_unsafe 0.039799999445676804, frac_unsafe 0.018799999728798866, n_nrf_cycles 0.015200000256299973, n_swarmp 0.006399999838322401, wall_concrete 0.006300000008195639, prev_status 0.005900000222027302, subcycle_code 0.0038999998942017555, n_subsequent_last 0.003100000089034438

## Cycle 9 vs DOB 2022 score on the common set (DOB possibly in-sample — not a fair test)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 12116 | 0.260 | 0.365 | 0.625 | 0.628 | 0.554 | 0.497 | 0.088 |
| logistic_history | 12116 | 0.260 | 0.403 | 0.647 | 0.636 | 0.584 | 0.498 | 0.093 |
| xgboost | 12116 | 0.260 | 0.390 | 0.635 | 0.508 | 0.520 | 0.525 | 0.083 |
| xgboost_calibrated | 12116 | 0.260 | 0.376 | 0.635 | 0.492 | 0.468 | 0.498 | 0.074 |
| dob_predprob_2022 | 12116 | 0.260 | 0.341 | 0.601 | 0.412 | 0.402 | 0.412 | 0.064 |

- xgboost_minus_dob_predprob_2022 · pr_auc: +0.049 (95% CI +0.032 to +0.066)

- xgboost_minus_dob_predprob_2022 · precision@500: +0.118 (95% CI +0.068 to +0.180)

- xgboost_minus_rule_prev_status · pr_auc: +0.025 (95% CI +0.013 to +0.040)

- xgboost_minus_rule_prev_status · precision@500: -0.034 (95% CI -0.092 to +0.020)

## Matched information date 2022-03-17 → cycle-10 filers (fair DOB comparison)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 2400 | 0.276 | 0.461 | 0.709 | 0.544 | 0.482 | 0.436 | 0.364 |
| logistic_history | 2400 | 0.276 | 0.428 | 0.701 | 0.504 | 0.486 | 0.413 | 0.367 |
| xgboost | 2400 | 0.276 | 0.487 | 0.717 | 0.552 | 0.534 | 0.423 | 0.403 |
| xgboost_calibrated | 2400 | 0.276 | 0.439 | 0.700 | 0.532 | 0.422 | 0.418 | 0.319 |
| dob_predprob_2022 | 2400 | 0.276 | 0.414 | 0.670 | 0.472 | 0.482 | 0.411 | 0.364 |

- xgboost_minus_dob_predprob_2022 · pr_auc: +0.073 (95% CI +0.032 to +0.113)

- xgboost_minus_dob_predprob_2022 · precision@500: +0.052 (95% CI +0.000 to +0.100)

- xgboost_minus_rule_prev_status · pr_auc: +0.026 (95% CI -0.011 to +0.066)

- xgboost_minus_rule_prev_status · precision@500: +0.052 (95% CI -0.040 to +0.056)

## Current model (cutoff 2025-02-21) → cycle-10 filers to date (self-selected)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 2853 | 0.255 | 0.471 | 0.731 | 0.584 | 0.538 | 0.464 | 0.370 |
| logistic_history | 2853 | 0.255 | 0.533 | 0.774 | 0.652 | 0.604 | 0.485 | 0.415 |
| xgboost | 2853 | 0.255 | 0.653 | 0.834 | 0.804 | 0.690 | 0.540 | 0.475 |
| xgboost_calibrated | 2853 | 0.255 | 0.623 | 0.833 | 0.804 | 0.688 | 0.533 | 0.473 |

- xgboost_minus_rule_prev_status · pr_auc: +0.182 (95% CI +0.155 to +0.207)

- xgboost_minus_rule_prev_status · precision@500: +0.152 (95% CI +0.098 to +0.180)

- xgboost_minus_logistic_history · pr_auc: +0.120 (95% CI +0.095 to +0.144)

- xgboost_minus_logistic_history · precision@500: +0.086 (95% CI +0.046 to +0.124)

Selection check: 76.9% of cycle-10 filers so far had No Report Filed in cycle 9 (vs 34.1% of cycle-9 filers for cycle 8); UNSAFE rate 0.297 with vs 0.114 without.

## Cycle-10 filers, sub-cycle A only, excluding prior No-Report-Filed (closest to representative)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 469 | 0.058 | 0.158 | 0.642 | 0.072 | — | — | — |
| logistic_history | 469 | 0.058 | 0.170 | 0.657 | 0.080 | — | — | — |
| xgboost | 469 | 0.058 | 0.246 | 0.738 | 0.084 | — | — | — |
| xgboost_calibrated | 469 | 0.058 | 0.230 | 0.731 | 0.076 | — | — | — |

- xgboost_minus_rule_prev_status · pr_auc: +0.088 (95% CI -0.040 to +0.267)

- xgboost_minus_rule_prev_status · precision@117: +0.034 (95% CI +0.000 to +0.068)

- xgboost_minus_logistic_history · pr_auc: +0.076 (95% CI -0.064 to +0.254)

- xgboost_minus_logistic_history · precision@117: +0.034 (95% CI +0.009 to +0.068)
