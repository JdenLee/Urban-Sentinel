# Results — UNSAFE at first Initial FISP filing of the target cycle

Run on `arm64` (macOS-15.6.1-arm64-arm-64bit), 2026-10-17T17:04:26.598905+00:00, 99.5 s

## Primary test: cycle 9 (cutoff 2020-02-21, trained on cycles 7–8)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 13327 | 0.250 | 0.358 | 0.626 | 0.628 | 0.560 | 0.502 | 0.084 |
| logistic_history | 13327 | 0.250 | 0.389 | 0.640 | 0.636 | 0.582 | 0.496 | 0.087 |
| xgboost | 13327 | 0.250 | 0.454 | 0.696 | 0.736 | 0.662 | 0.612 | 0.099 |
| xgboost_calibrated | 13327 | 0.250 | 0.454 | 0.696 | 0.736 | 0.662 | 0.612 | 0.099 |
| xgboost_facade_only | 13327 | 0.250 | 0.379 | 0.629 | 0.520 | 0.522 | 0.522 | 0.078 |

- xgboost_minus_rule_prev_status · pr_auc: +0.096 (95% CI +0.083 to +0.108)

- xgboost_minus_rule_prev_status · precision@500: +0.102 (95% CI +0.050 to +0.148)

- xgboost_minus_logistic_history · pr_auc: +0.065 (95% CI +0.052 to +0.077)

- xgboost_minus_logistic_history · precision@500: +0.080 (95% CI +0.024 to +0.124)

- xgboost_minus_xgboost_facade_only · pr_auc: +0.075 (95% CI +0.064 to +0.087)

- xgboost_minus_xgboost_facade_only · precision@500: +0.140 (95% CI +0.092 to +0.186)

## Cycle 9 subgroup: previously_safe

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 4253 | 0.183 | 0.205 | 0.555 | 0.204 | 0.198 | 0.257 | 0.127 |
| logistic_history | 4253 | 0.183 | 0.219 | 0.568 | 0.252 | 0.256 | 0.215 | 0.165 |
| xgboost | 4253 | 0.183 | 0.289 | 0.649 | 0.384 | 0.334 | 0.297 | 0.215 |
| xgboost_calibrated | 4253 | 0.183 | 0.289 | 0.649 | 0.384 | 0.334 | 0.297 | 0.215 |
| xgboost_facade_only | 4253 | 0.183 | 0.227 | 0.548 | 0.324 | 0.296 | 0.234 | 0.190 |

- xgboost_minus_rule_prev_status · pr_auc: +0.084 (95% CI +0.062 to +0.110)

- xgboost_minus_rule_prev_status · precision@250: +0.180 (95% CI +0.072 to +0.220)

- xgboost_minus_logistic_history · pr_auc: +0.071 (95% CI +0.052 to +0.092)

- xgboost_minus_logistic_history · precision@250: +0.132 (95% CI +0.060 to +0.204)

## Cycle 9 subgroup: previously_swarmp

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 5011 | 0.242 | 0.253 | 0.525 | 0.284 | 0.280 | 0.290 | 0.115 |
| logistic_history | 5011 | 0.242 | 0.316 | 0.595 | 0.424 | 0.406 | 0.347 | 0.167 |
| xgboost | 5011 | 0.242 | 0.355 | 0.635 | 0.508 | 0.448 | 0.379 | 0.185 |
| xgboost_calibrated | 5011 | 0.242 | 0.355 | 0.635 | 0.508 | 0.448 | 0.379 | 0.185 |
| xgboost_facade_only | 5011 | 0.242 | 0.274 | 0.556 | 0.276 | 0.314 | 0.313 | 0.129 |

- xgboost_minus_rule_prev_status · pr_auc: +0.101 (95% CI +0.083 to +0.122)

- xgboost_minus_rule_prev_status · precision@250: +0.224 (95% CI +0.132 to +0.276)

- xgboost_minus_logistic_history · pr_auc: +0.039 (95% CI +0.020 to +0.059)

- xgboost_minus_logistic_history · precision@250: +0.084 (95% CI +0.008 to +0.148)

## Cycle 9 subgroup: previously_unsafe

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 2610 | 0.418 | 0.487 | 0.594 | 0.628 | 0.560 | 0.502 | 0.257 |
| logistic_history | 2610 | 0.418 | 0.529 | 0.626 | 0.636 | 0.600 | 0.503 | 0.275 |
| xgboost | 2610 | 0.418 | 0.631 | 0.701 | 0.744 | 0.688 | 0.597 | 0.315 |
| xgboost_calibrated | 2610 | 0.418 | 0.631 | 0.701 | 0.744 | 0.688 | 0.597 | 0.315 |
| xgboost_facade_only | 2610 | 0.418 | 0.552 | 0.646 | 0.640 | 0.616 | 0.537 | 0.282 |

- xgboost_minus_rule_prev_status · pr_auc: +0.144 (95% CI +0.117 to +0.171)

- xgboost_minus_rule_prev_status · precision@250: +0.116 (95% CI +0.048 to +0.188)

- xgboost_minus_logistic_history · pr_auc: +0.102 (95% CI +0.074 to +0.129)

- xgboost_minus_logistic_history · precision@250: +0.108 (95% CI +0.048 to +0.188)

## Cycle 9 subgroup: no_prior_filing

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 1441 | 0.173 | 0.173 | 0.500 | 0.260 | 0.184 | 0.193 | 0.369 |
| logistic_history | 1441 | 0.173 | 0.204 | 0.584 | 0.200 | 0.230 | 0.207 | 0.462 |
| xgboost | 1441 | 0.173 | 0.321 | 0.700 | 0.336 | 0.308 | 0.214 | 0.618 |
| xgboost_calibrated | 1441 | 0.173 | 0.321 | 0.700 | 0.336 | 0.308 | 0.214 | 0.618 |
| xgboost_facade_only | 1441 | 0.173 | 0.265 | 0.578 | 0.260 | 0.240 | 0.185 | 0.482 |

- xgboost_minus_rule_prev_status · pr_auc: +0.148 (95% CI +0.111 to +0.199)

- xgboost_minus_rule_prev_status · precision@250: +0.076 (95% CI +0.096 to +0.220)

- xgboost_minus_logistic_history · pr_auc: +0.118 (95% CI +0.083 to +0.166)

- xgboost_minus_logistic_history · precision@250: +0.136 (95% CI +0.048 to +0.172)

Calibration (cycle 9, Platt scaling fit on cycle 8): Brier 0.1705, ECE 0.0362, mean predicted 0.256 vs observed 0.250

By sub-cycle (xgboost): A: PR-AUC 0.465 (base 0.264, n=5234), B: PR-AUC 0.459 (base 0.239, n=4133), C: PR-AUC 0.442 (base 0.244, n=3960)

Never-filers in cycle 9: 3071 vs 13327 labeled; last-status mix never-filers {-1.0: 0.357, 1.0: 0.227, 0.0: 0.212, 2.0: 0.204} vs labeled {1.0: 0.376, 0.0: 0.32, 2.0: 0.196, -1.0: 0.108} (-1 none, 0 SAFE, 1 SWARMP, 2 UNSAFE)

Top mean |SHAP|: status_at_cutoff 0.26969999074935913, dob_facade_ever 0.241799995303154, lot_area 0.13079999387264252, bldg_age 0.10279999673366547, dob_facade_years_since 0.09769999980926514, years_since_last_filing 0.08269999921321869, ecb_report_years_since 0.048700001090765, num_floors 0.04830000177025795, wall_brick 0.041200000792741776, dob_fisp_compliance_5y 0.0357000008225441, ecb_wall_years_since 0.035599999129772186, days_vs_deadline_last 0.03319999948143959, cycles_since_last 0.02370000071823597, last_status 0.023499999195337296, borough_code 0.02290000021457672

## Cycle 9 vs DOB 2022 score on the common set (DOB possibly in-sample — not a fair test)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 12116 | 0.260 | 0.365 | 0.625 | 0.628 | 0.554 | 0.497 | 0.088 |
| logistic_history | 12116 | 0.260 | 0.403 | 0.647 | 0.636 | 0.584 | 0.498 | 0.093 |
| xgboost | 12116 | 0.260 | 0.461 | 0.690 | 0.732 | 0.660 | 0.614 | 0.105 |
| xgboost_calibrated | 12116 | 0.260 | 0.461 | 0.690 | 0.732 | 0.660 | 0.614 | 0.105 |
| xgboost_facade_only | 12116 | 0.260 | 0.390 | 0.635 | 0.508 | 0.520 | 0.525 | 0.083 |
| dob_predprob_2022 | 12116 | 0.260 | 0.341 | 0.601 | 0.412 | 0.402 | 0.412 | 0.064 |

- xgboost_minus_dob_predprob_2022 · pr_auc: +0.120 (95% CI +0.104 to +0.137)

- xgboost_minus_dob_predprob_2022 · precision@500: +0.258 (95% CI +0.210 to +0.316)

- xgboost_minus_rule_prev_status · pr_auc: +0.096 (95% CI +0.083 to +0.110)

- xgboost_minus_rule_prev_status · precision@500: +0.106 (95% CI +0.052 to +0.152)

## Matched information date 2022-03-17 → cycle-10 filers (fair DOB comparison)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 2400 | 0.276 | 0.461 | 0.709 | 0.544 | 0.482 | 0.436 | 0.364 |
| logistic_history | 2400 | 0.276 | 0.428 | 0.701 | 0.504 | 0.486 | 0.413 | 0.367 |
| xgboost | 2400 | 0.276 | 0.668 | 0.816 | 0.784 | 0.680 | 0.503 | 0.514 |
| xgboost_calibrated | 2400 | 0.276 | 0.668 | 0.816 | 0.784 | 0.680 | 0.503 | 0.514 |
| dob_predprob_2022 | 2400 | 0.276 | 0.414 | 0.670 | 0.472 | 0.482 | 0.411 | 0.364 |

- xgboost_minus_dob_predprob_2022 · pr_auc: +0.253 (95% CI +0.214 to +0.287)

- xgboost_minus_dob_predprob_2022 · precision@500: +0.198 (95% CI +0.154 to +0.242)

- xgboost_minus_rule_prev_status · pr_auc: +0.207 (95% CI +0.177 to +0.237)

- xgboost_minus_rule_prev_status · precision@500: +0.198 (95% CI +0.116 to +0.202)

## Current model (cutoff 2025-02-21) → cycle-10 filers to date (self-selected)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 2853 | 0.255 | 0.471 | 0.731 | 0.584 | 0.538 | 0.464 | 0.370 |
| logistic_history | 2853 | 0.255 | 0.533 | 0.774 | 0.652 | 0.604 | 0.485 | 0.415 |
| xgboost | 2853 | 0.255 | 0.692 | 0.854 | 0.804 | 0.704 | 0.561 | 0.484 |
| xgboost_calibrated | 2853 | 0.255 | 0.692 | 0.854 | 0.804 | 0.704 | 0.561 | 0.484 |

- xgboost_minus_rule_prev_status · pr_auc: +0.221 (95% CI +0.190 to +0.249)

- xgboost_minus_rule_prev_status · precision@500: +0.166 (95% CI +0.102 to +0.194)

- xgboost_minus_logistic_history · pr_auc: +0.160 (95% CI +0.130 to +0.186)

- xgboost_minus_logistic_history · precision@500: +0.100 (95% CI +0.052 to +0.138)

Selection check: 76.9% of cycle-10 filers so far had No Report Filed in cycle 9 (vs 34.1% of cycle-9 filers for cycle 8); UNSAFE rate 0.297 with vs 0.114 without.

## Cycle-10 filers, sub-cycle A only, excluding prior No-Report-Filed (closest to representative)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 469 | 0.058 | 0.158 | 0.642 | 0.072 | — | — | — |
| logistic_history | 469 | 0.058 | 0.170 | 0.657 | 0.080 | — | — | — |
| xgboost | 469 | 0.058 | 0.157 | 0.734 | 0.084 | — | — | — |
| xgboost_calibrated | 469 | 0.058 | 0.157 | 0.734 | 0.084 | — | — | — |

- xgboost_minus_rule_prev_status · pr_auc: -0.001 (95% CI -0.097 to +0.111)

- xgboost_minus_rule_prev_status · precision@117: +0.034 (95% CI +0.000 to +0.068)

- xgboost_minus_logistic_history · pr_auc: -0.013 (95% CI -0.112 to +0.097)

- xgboost_minus_logistic_history · precision@117: +0.034 (95% CI +0.009 to +0.068)
