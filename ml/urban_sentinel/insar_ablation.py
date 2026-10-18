"""Does OPERA DISP-S1 ground motion add predictive value beyond the deployed feature set?

Two designs (see ml/insar/README.md, "Leakage note"):
  A. Primary split (train cycles 7-8, test cycle 9) with InSAR attached as a static building covariate.
     The test fold is clean (all InSAR epochs precede 2020-02-21), but training rows see 2016-2020
     motion measured after their own cutoffs.
  B. Clean design: 5-fold cross-validation inside cycle 9 only, folds grouped by tax block so neighbours
     sharing 30 m radar pixels never straddle train/test. Every feature precedes the cutoff.
Only motion features are used; DEM error (mostly building height) and quality/support counts are left out.
Run from ml/:  python -m urban_sentinel.insar_ablation   (needs data/insar/insar_features_cutoff_2020-02-21.csv.gz)
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

from .config import DATA_DIR, REPORTS_DIR
from .evaluation import paired_bootstrap, ranking_metrics
from .experiments import fit_all, make_dataset
from .featureset import Context
from .ingest import facade_bbls
from .models import fit_xgb

INSAR_FILE = DATA_DIR / "insar" / "insar_features_cutoff_2020-02-21.csv.gz"
MOTION_FEATURES = ["insar_vel_hp2km_mm_yr", "insar_vel_diff_local_mm_yr", "insar_acc_los_mm_yr2",
                   "insar_seasonal_amp_mm", "insar_vel_iqr_mm_yr"]


def load_insar() -> pd.DataFrame:
    df = pd.read_csv(INSAR_FILE)
    df["bin"] = df["bin"].astype(str)
    motion = df.set_index("bin")[MOTION_FEATURES]
    # Winsorise at the 0.5/99.5th percentiles: ±20 mm/yr outliers are construction sites and water edges.
    lo, hi = motion.quantile(0.005), motion.quantile(0.995)
    return motion.clip(lo, hi, axis=1)


def _with_insar(X: pd.DataFrame, insar: pd.DataFrame) -> pd.DataFrame:
    return pd.concat([X, insar.reindex(X.index)], axis=1)


def _summary(y, with_s, without_s, prev_safe) -> dict:
    return {
        "without_insar": ranking_metrics(y, without_s), "with_insar": ranking_metrics(y, with_s),
        "delta_pr_auc": paired_bootstrap(y, with_s, without_s, "pr_auc"),
        "delta_precision@500": paired_bootstrap(y, with_s, without_s, "precision@500"),
        "previously_safe_delta_pr_auc": paired_bootstrap(y[prev_safe], with_s[prev_safe], without_s[prev_safe], "pr_auc"),
    }


def run() -> dict:
    ctx = Context.load()
    insar = load_insar()
    d = {t: make_dataset(ctx, t) for t in (7, 8, 9)}
    X9, lab9 = d[9]
    y9 = lab9["y"].to_numpy()
    prev_safe = ((X9["last_status"] == 0) & (X9["status_at_cutoff"] <= 0)).to_numpy()
    out = {"motion_features": MOTION_FEATURES,
           "coverage_cycle9": float(insar.reindex(X9.index)[MOTION_FEATURES[0]].notna().mean())}

    # A: primary split, InSAR as a static covariate.
    scores = {}
    for name, prep in [("without", lambda X: X), ("with", lambda X: _with_insar(X, insar))]:
        model, _, _, _ = fit_all([(prep(d[7][0]), d[7][1]["y"]), (prep(d[8][0]), d[8][1]["y"])],
                                 (prep(d[8][0]), d[8][1]["y"]))
        scores[name] = model.predict_proba(prep(X9))[:, 1]
    out["A_primary_split_static_covariate"] = _summary(y9, scores["with"], scores["without"], prev_safe)

    # B: grouped cross-validation within cycle 9 (clean).
    bbl = facade_bbls(ctx.fac).reindex(X9.index).fillna("unknown")
    groups = bbl.str[:6].to_numpy()  # borough + block
    oof = {"with": np.zeros(len(y9)), "without": np.zeros(len(y9))}
    X9w = _with_insar(X9, insar)
    for train, test in GroupKFold(n_splits=5).split(X9, y9, groups):
        for name, X in [("without", X9), ("with", X9w)]:
            inner = np.random.default_rng(0).random(len(train)) < 0.8  # early-stopping split
            probe = fit_xgb(X.iloc[train[inner]], y9[train[inner]], X.iloc[train[~inner]], y9[train[~inner]])
            model = fit_xgb(X.iloc[train], y9[train], n_estimators=max(50, round((probe.best_iteration + 1) * 1.15)))
            oof[name][test] = model.predict_proba(X.iloc[test])[:, 1]
    out["B_cycle9_grouped_cv"] = _summary(y9, oof["with"], oof["without"], prev_safe)
    return out


def write_markdown(out: dict) -> str:
    lines = ["# InSAR ablation: does ground motion add predictive value?", "",
             f"Motion features: {', '.join(out['motion_features'])}. Cycle-9 coverage {out['coverage_cycle9']:.1%}.", "",
             "| design | PR-AUC without | PR-AUC with | Δ PR-AUC (95% CI) | Δ P@500 (95% CI) | Δ prev-SAFE PR-AUC (95% CI) |",
             "|---|---|---|---|---|---|"]
    fmt = lambda b: f"{b['diff']:+.3f} ({b['ci95'][0]:+.3f}, {b['ci95'][1]:+.3f})"
    for key, label in [("A_primary_split_static_covariate", "A: train 7–8 → test 9 (static covariate; caveat)"),
                       ("B_cycle9_grouped_cv", "B: cycle-9 5-fold CV grouped by block (clean)")]:
        r = out[key]
        lines.append(f"| {label} | {r['without_insar']['pr_auc']:.3f} | {r['with_insar']['pr_auc']:.3f} | "
                     f"{fmt(r['delta_pr_auc'])} | {fmt(r['delta_precision@500'])} | {fmt(r['previously_safe_delta_pr_auc'])} |")
    return "\n".join(lines)


if __name__ == "__main__":
    result = run()
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / "insar_ablation.json").write_text(json.dumps(result, indent=2, default=str))
    (REPORTS_DIR / "INSAR_ABLATION.md").write_text(write_markdown(result))
    print(write_markdown(result))
