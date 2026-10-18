# InSAR ablation: does ground motion add predictive value?

Motion features: insar_vel_hp2km_mm_yr, insar_vel_diff_local_mm_yr, insar_acc_los_mm_yr2, insar_seasonal_amp_mm, insar_vel_iqr_mm_yr. Cycle-9 coverage 99.6%.

| design | PR-AUC without | PR-AUC with | Δ PR-AUC (95% CI) | Δ P@500 (95% CI) | Δ prev-SAFE PR-AUC (95% CI) |
|---|---|---|---|---|---|
| A: train 7–8 → test 9 (static covariate; caveat) | 0.454 | 0.452 | -0.002 (-0.006, +0.002) | +0.030 (+0.010, +0.050) | -0.000 (-0.007, +0.007) |
| B: cycle-9 5-fold CV grouped by block (clean) | 0.457 | 0.459 | +0.001 (-0.004, +0.006) | -0.012 (-0.042, +0.014) | +0.007 (-0.004, +0.019) |