# Results — UNSAFE at first Initial FISP filing of the target cycle

Run on `s390x` (Linux-5.14.0-687.58.1.el9_8.s390x-s390x-with-glibc2.39), 2026-10-17T19:40:26.373700+00:00, 225.9 s

## Primary test: cycle 9 (cutoff 2020-02-21, trained on cycles 7–8)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 13327 | 0.250 | 0.358 | 0.626 | 0.628 | 0.560 | 0.502 | 0.084 |
| logistic_history | 13327 | 0.250 | 0.389 | 0.640 | 0.636 | 0.582 | 0.496 | 0.087 |
| xgboost | 13327 | 0.250 | 0.451 | 0.697 | 0.716 | 0.660 | 0.614 | 0.099 |
| xgboost_calibrated | 13327 | 0.250 | 0.451 | 0.697 | 0.716 | 0.660 | 0.614 | 0.099 |
| xgboost_facade_only | 13327 | 0.250 | 0.378 | 0.628 | 0.508 | 0.510 | 0.526 | 0.076 |

- xgboost_minus_rule_prev_status · pr_auc: +0.092 (95% CI +0.079 to +0.105)

- xgboost_minus_rule_prev_status · precision@500: +0.100 (95% CI +0.048 to +0.146)

- xgboost_minus_logistic_history · pr_auc: +0.061 (95% CI +0.048 to +0.074)

- xgboost_minus_logistic_history · precision@500: +0.078 (95% CI +0.020 to +0.122)

- xgboost_minus_xgboost_facade_only · pr_auc: +0.073 (95% CI +0.061 to +0.085)

- xgboost_minus_xgboost_facade_only · precision@500: +0.150 (95% CI +0.104 to +0.196)

## Cycle 9 subgroup: previously_safe

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 4253 | 0.183 | 0.205 | 0.555 | 0.204 | 0.198 | 0.257 | 0.127 |
| logistic_history | 4253 | 0.183 | 0.219 | 0.568 | 0.260 | 0.256 | 0.214 | 0.165 |
| xgboost | 4253 | 0.183 | 0.287 | 0.648 | 0.392 | 0.376 | 0.300 | 0.242 |
| xgboost_calibrated | 4253 | 0.183 | 0.287 | 0.648 | 0.392 | 0.376 | 0.300 | 0.242 |
| xgboost_facade_only | 4253 | 0.183 | 0.227 | 0.547 | 0.320 | 0.302 | 0.234 | 0.194 |

- xgboost_minus_rule_prev_status · pr_auc: +0.082 (95% CI +0.061 to +0.108)

- xgboost_minus_rule_prev_status · precision@250: +0.188 (95% CI +0.072 to +0.220)

- xgboost_minus_logistic_history · pr_auc: +0.069 (95% CI +0.050 to +0.090)

- xgboost_minus_logistic_history · precision@250: +0.132 (95% CI +0.064 to +0.204)

## Cycle 9 subgroup: previously_swarmp

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 5011 | 0.242 | 0.253 | 0.525 | 0.284 | 0.280 | 0.290 | 0.115 |
| logistic_history | 5011 | 0.242 | 0.316 | 0.595 | 0.424 | 0.404 | 0.347 | 0.167 |
| xgboost | 5011 | 0.242 | 0.354 | 0.636 | 0.476 | 0.432 | 0.375 | 0.178 |
| xgboost_calibrated | 5011 | 0.242 | 0.354 | 0.636 | 0.476 | 0.432 | 0.375 | 0.178 |
| xgboost_facade_only | 5011 | 0.242 | 0.270 | 0.549 | 0.292 | 0.304 | 0.307 | 0.125 |

- xgboost_minus_rule_prev_status · pr_auc: +0.101 (95% CI +0.082 to +0.121)

- xgboost_minus_rule_prev_status · precision@250: +0.192 (95% CI +0.116 to +0.264)

- xgboost_minus_logistic_history · pr_auc: +0.038 (95% CI +0.021 to +0.059)

- xgboost_minus_logistic_history · precision@250: +0.052 (95% CI -0.008 to +0.132)

## Cycle 9 subgroup: previously_unsafe

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 2610 | 0.418 | 0.487 | 0.594 | 0.628 | 0.560 | 0.502 | 0.257 |
| logistic_history | 2610 | 0.418 | 0.529 | 0.626 | 0.636 | 0.600 | 0.503 | 0.275 |
| xgboost | 2610 | 0.418 | 0.621 | 0.698 | 0.712 | 0.688 | 0.601 | 0.315 |
| xgboost_calibrated | 2610 | 0.418 | 0.621 | 0.698 | 0.712 | 0.688 | 0.601 | 0.315 |
| xgboost_facade_only | 2610 | 0.418 | 0.555 | 0.650 | 0.628 | 0.622 | 0.558 | 0.285 |

- xgboost_minus_rule_prev_status · pr_auc: +0.134 (95% CI +0.107 to +0.162)

- xgboost_minus_rule_prev_status · precision@250: +0.084 (95% CI +0.016 to +0.168)

- xgboost_minus_logistic_history · pr_auc: +0.091 (95% CI +0.066 to +0.118)

- xgboost_minus_logistic_history · precision@250: +0.076 (95% CI +0.012 to +0.164)

## Cycle 9 subgroup: no_prior_filing

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 1441 | 0.173 | 0.173 | 0.500 | 0.260 | 0.184 | 0.193 | 0.369 |
| logistic_history | 1441 | 0.173 | 0.204 | 0.584 | 0.200 | 0.230 | 0.207 | 0.462 |
| xgboost | 1441 | 0.173 | 0.341 | 0.705 | 0.344 | 0.300 | 0.219 | 0.602 |
| xgboost_calibrated | 1441 | 0.173 | 0.341 | 0.705 | 0.344 | 0.300 | 0.219 | 0.602 |
| xgboost_facade_only | 1441 | 0.173 | 0.228 | 0.573 | 0.240 | 0.246 | 0.188 | 0.494 |

- xgboost_minus_rule_prev_status · pr_auc: +0.168 (95% CI +0.127 to +0.223)

- xgboost_minus_rule_prev_status · precision@250: +0.084 (95% CI +0.104 to +0.232)

- xgboost_minus_logistic_history · pr_auc: +0.137 (95% CI +0.101 to +0.187)

- xgboost_minus_logistic_history · precision@250: +0.144 (95% CI +0.052 to +0.180)

Calibration (cycle 9, Platt scaling fit on cycle 8): Brier 0.1704, ECE 0.0349, mean predicted 0.258 vs observed 0.250

By sub-cycle (xgboost): A: PR-AUC 0.465 (base 0.264, n=5234), B: PR-AUC 0.455 (base 0.239, n=4133), C: PR-AUC 0.438 (base 0.244, n=3960)

Never-filers in cycle 9: 3071 vs 13327 labeled; last-status mix never-filers {-1.0: 0.357, 1.0: 0.227, 0.0: 0.212, 2.0: 0.204} vs labeled {1.0: 0.376, 0.0: 0.32, 2.0: 0.196, -1.0: 0.108} (-1 none, 0 SAFE, 1 SWARMP, 2 UNSAFE)

Top mean |SHAP|: status_at_cutoff 0.2872999906539917, dob_facade_ever 0.25279998779296875, lot_area 0.15039999783039093, bldg_age 0.1273999959230423, years_since_last_filing 0.09130000323057175, dob_facade_years_since 0.08709999918937683, ecb_report_years_since 0.07180000096559525, num_floors 0.06599999964237213, wall_brick 0.04639999940991402, ecb_wall_years_since 0.041099999099969864, days_vs_deadline_last 0.03889999911189079, dob_fisp_compliance_5y 0.03290000185370445, borough_code 0.031700000166893005, class_condo 0.028599999845027924, cycles_since_last 0.026900000870227814

## Cycle 9 vs DOB 2022 score on the common set (DOB possibly in-sample — not a fair test)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 12116 | 0.260 | 0.365 | 0.625 | 0.628 | 0.554 | 0.497 | 0.088 |
| logistic_history | 12116 | 0.260 | 0.403 | 0.647 | 0.636 | 0.584 | 0.498 | 0.093 |
| xgboost | 12116 | 0.260 | 0.458 | 0.691 | 0.716 | 0.664 | 0.613 | 0.105 |
| xgboost_calibrated | 12116 | 0.260 | 0.458 | 0.691 | 0.716 | 0.664 | 0.613 | 0.105 |
| xgboost_facade_only | 12116 | 0.260 | 0.389 | 0.634 | 0.508 | 0.508 | 0.522 | 0.081 |
| dob_predprob_2022 | 12116 | 0.260 | 0.341 | 0.601 | 0.412 | 0.402 | 0.412 | 0.064 |

- xgboost_minus_dob_predprob_2022 · pr_auc: +0.116 (95% CI +0.100 to +0.134)

- xgboost_minus_dob_predprob_2022 · precision@500: +0.262 (95% CI +0.208 to +0.316)

- xgboost_minus_rule_prev_status · pr_auc: +0.093 (95% CI +0.079 to +0.107)

- xgboost_minus_rule_prev_status · precision@500: +0.110 (95% CI +0.050 to +0.150)

## Matched information date 2022-03-17 → cycle-10 filers (fair DOB comparison)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 2408 | 0.275 | 0.461 | 0.709 | 0.544 | 0.482 | 0.437 | 0.363 |
| logistic_history | 2408 | 0.275 | 0.427 | 0.701 | 0.504 | 0.488 | 0.414 | 0.368 |
| xgboost | 2408 | 0.275 | 0.649 | 0.812 | 0.780 | 0.676 | 0.513 | 0.510 |
| xgboost_calibrated | 2408 | 0.275 | 0.649 | 0.812 | 0.780 | 0.676 | 0.513 | 0.510 |
| dob_predprob_2022 | 2408 | 0.275 | 0.416 | 0.671 | 0.472 | 0.482 | 0.412 | 0.363 |

- xgboost_minus_dob_predprob_2022 · pr_auc: +0.233 (95% CI +0.191 to +0.266)

- xgboost_minus_dob_predprob_2022 · precision@500: +0.194 (95% CI +0.142 to +0.232)

- xgboost_minus_rule_prev_status · pr_auc: +0.188 (95% CI +0.157 to +0.219)

- xgboost_minus_rule_prev_status · precision@500: +0.194 (95% CI +0.106 to +0.192)

## Current model (cutoff 2025-02-21) → cycle-10 filers to date (self-selected)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 2864 | 0.255 | 0.471 | 0.731 | 0.584 | 0.538 | 0.464 | 0.369 |
| logistic_history | 2864 | 0.255 | 0.533 | 0.774 | 0.652 | 0.604 | 0.486 | 0.414 |
| xgboost | 2864 | 0.255 | 0.694 | 0.854 | 0.792 | 0.700 | 0.569 | 0.480 |
| xgboost_calibrated | 2864 | 0.255 | 0.694 | 0.854 | 0.792 | 0.700 | 0.569 | 0.480 |

- xgboost_minus_rule_prev_status · pr_auc: +0.223 (95% CI +0.192 to +0.249)

- xgboost_minus_rule_prev_status · precision@500: +0.162 (95% CI +0.106 to +0.196)

- xgboost_minus_logistic_history · pr_auc: +0.161 (95% CI +0.129 to +0.188)

- xgboost_minus_logistic_history · precision@500: +0.096 (95% CI +0.052 to +0.134)

Selection check: 76.8% of cycle-10 filers so far had No Report Filed in cycle 9 (vs 34.1% of cycle-9 filers for cycle 8); UNSAFE rate 0.297 with vs 0.114 without.

## Cycle-10 filers, sub-cycle A only, excluding prior No-Report-Filed (closest to representative)

| method | n | base_rate | pr_auc | roc_auc | precision@250 | precision@500 | precision@1000 | recall@500 |
|---|---|---|---|---|---|---|---|---|
| rule_prev_status | 472 | 0.059 | 0.157 | 0.643 | 0.076 | — | — | — |
| logistic_history | 472 | 0.059 | 0.168 | 0.660 | 0.084 | — | — | — |
| xgboost | 472 | 0.059 | 0.159 | 0.719 | 0.084 | — | — | — |
| xgboost_calibrated | 472 | 0.059 | 0.159 | 0.719 | 0.084 | — | — | — |

- xgboost_minus_rule_prev_status · pr_auc: +0.002 (95% CI -0.085 to +0.122)

- xgboost_minus_rule_prev_status · precision@118: +0.025 (95% CI +0.000 to +0.059)

- xgboost_minus_logistic_history · pr_auc: -0.010 (95% CI -0.100 to +0.104)

- xgboost_minus_logistic_history · precision@118: +0.025 (95% CI +0.000 to +0.059)
