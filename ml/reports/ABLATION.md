# Step 2 — source ablations (cycle-9 test)

train cycles 7-8, test cycle 9 at cutoff 2020-02-21

| variant | features | PR-AUC | P@500 | prev-SAFE PR-AUC | prev-SAFE P@250 | Δ PR-AUC vs façade (95% CI) | Δ prev-SAFE P@250 (95% CI) |
|---|---|---|---|---|---|---|---|
| facade_only | 34 | 0.379 | 0.522 | 0.227 | 0.324 | — | — |
| +dob_violations | 46 | 0.417 | 0.618 | 0.254 | 0.296 | +0.039 (+0.030, +0.049) | -0.028 (-0.088, +0.024) |
| +ecb_violations | 50 | 0.388 | 0.572 | 0.237 | 0.344 | +0.010 (+0.003, +0.016) | +0.020 (-0.044, +0.068) |
| +complaints | 66 | 0.377 | 0.522 | 0.222 | 0.296 | -0.002 (-0.007, +0.004) | -0.028 (-0.076, +0.016) |
| +building_attributes | 45 | 0.418 | 0.622 | 0.277 | 0.356 | +0.040 (+0.029, +0.050) | +0.032 (-0.024, +0.080) |
| +dob+ecb (no PLUTO snapshot) | 62 | 0.424 | 0.610 | 0.266 | 0.324 | +0.045 (+0.035, +0.054) | +0.000 (-0.056, +0.052) |
| +dob+ecb+building (deployed) | 73 | 0.454 | 0.662 | 0.289 | 0.384 | +0.075 (+0.064, +0.087) | +0.060 (-0.004, +0.124) |
| +all | 105 | 0.446 | 0.642 | 0.283 | 0.388 | +0.067 (+0.056, +0.078) | +0.064 (-0.008, +0.124) |
| +all_echo_buffer_90d | 105 | 0.448 | 0.660 | 0.284 | 0.364 | +0.069 (+0.058, +0.081) | +0.040 (-0.024, +0.104) |

Top features by gain (+all): dob_facade_ever 134.02, cycles_since_last 60.36, n_cycles_filed 48.17, status_at_cutoff 47.04, n_amended_last 40.52, dob_facade_years_since 35.55, unsafe_streak 29.59, ecb_report_years_since 28.94, lot_area 28.74, wall_brick 26.67, ecb_report_ever 25.47, class_condo 23.96, last_status 22.63, n_safe 22.33, n_unsafe 22.03