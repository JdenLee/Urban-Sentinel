"""Leakage-controlled evaluation of next-cycle UNSAFE façade prediction.

Run from ml/:  python -m urban_sentinel.experiments
Writes reports/metrics.json and reports/RESULTS.md.
"""
from __future__ import annotations

import json
import time

import numpy as np
import xgboost as xgb
import pandas as pd

from . import evidence
from .config import CYCLE_START, DOB_FACADE_RISK_SNAPSHOT, REPORTS_DIR
from .evaluation import calibration_metrics, paired_bootstrap, ranking_metrics, reliability_table
from .features import FACADE_FEATURES
from .featureset import DEPLOYED_PARTS, Context, feature_matrix
from .ingest import load_dob_facade_risk
from .labels import build_labels, never_filers
from .models import PlattCalibrator, fit_logistic, fit_xgb, predict_logistic, rule_score


def make_dataset(ctx, target_cycle: int, cutoff: pd.Timestamp | None = None, parts=DEPLOYED_PARTS):
    """Features + labels for one target cycle. Passing a bare façade DataFrame gives façade-only features."""
    if isinstance(ctx, pd.DataFrame):
        ctx, parts = Context(ctx), ()
    cutoff = CYCLE_START[target_cycle] if cutoff is None else pd.Timestamp(cutoff)
    labels = build_labels(ctx.fac, target_cycle)
    X = feature_matrix(ctx, labels.index, cutoff, target_cycle, parts)
    return X, labels


def fit_all(train_sets, valid_set):
    """Early-stop XGBoost on the latest training cycle, calibrate on it out-of-time, then refit on all."""
    early = train_sets[:-1]
    X_valid, y_valid = valid_set
    X_e = pd.concat([x for x, _ in early])
    y_e = pd.concat([y for _, y in early])
    probe = fit_xgb(X_e, y_e, X_valid, y_valid)
    best_rounds = int(probe.best_iteration) + 1
    calibrator = PlattCalibrator.fit(probe.predict_proba(X_valid)[:, 1], y_valid.to_numpy())
    X_all = pd.concat([x for x, _ in train_sets])
    y_all = pd.concat([y for _, y in train_sets])
    final = fit_xgb(X_all, y_all, n_estimators=max(50, round(best_rounds * 1.15)))
    logit = fit_logistic(X_all, y_all)
    return final, calibrator, logit, best_rounds


def score_methods(X, final, calibrator, logit) -> dict[str, np.ndarray]:
    raw = final.predict_proba(X)[:, 1]
    return {"rule_prev_status": rule_score(X), "logistic_history": predict_logistic(logit, X),
            "xgboost": raw, "xgboost_calibrated": calibrator.predict(raw)}


def compare(y, scores: dict, ref="xgboost", against=("rule_prev_status", "logistic_history"),
            capacity_metric="precision@500") -> dict:
    out = {"metrics": {name: ranking_metrics(y, s) for name, s in scores.items()}, "bootstrap": {}}
    k = int(capacity_metric.split("@")[1])
    if k > len(y) // 4:  # small subsets: keep the capacity meaningful relative to the population
        capacity_metric = f"precision@{max(25, len(y) // 4)}"
    for other in against:
        if other in scores:
            out["bootstrap"][f"{ref}_minus_{other}"] = [
                paired_bootstrap(y, scores[ref], scores[other], "pr_auc"),
                paired_bootstrap(y, scores[ref], scores[other], capacity_metric),
            ]
    return out


def run() -> dict:
    t0 = time.time()
    ctx = Context.load()
    fac = ctx.fac
    report: dict = {"run": evidence.fingerprint(), "label": "UNSAFE among Initial FISP filings of the target cycle (worst recorded status per building)",
                    "feature_set": ["facade", *DEPLOYED_PARTS]}

    # ---- Primary test: decision at the start of cycle 9, outcome = cycle-9 filing ----------------------
    d7, d8, d9 = (make_dataset(ctx, t) for t in (7, 8, 9))
    to_xy = lambda d: (d[0], d[1]["y"])
    final, calibrator, logit, rounds = fit_all([to_xy(d7), to_xy(d8)], to_xy(d8))
    X9, lab9 = d9
    report["features"] = list(X9.columns)
    y9 = lab9["y"].to_numpy()
    s9 = score_methods(X9, final, calibrator, logit)
    facade_only = lambda d: (d[0][FACADE_FEATURES], d[1]["y"])
    f_only, _, _, _ = fit_all([facade_only(d7), facade_only(d8)], facade_only(d8))
    s9["xgboost_facade_only"] = f_only.predict_proba(X9[FACADE_FEATURES])[:, 1]
    primary = compare(y9, s9, against=("rule_prev_status", "logistic_history", "xgboost_facade_only"))
    primary["train"] = {"cycles": [7, 8], "n": int(len(d7[1]) + len(d8[1])), "xgb_rounds_early_stop": rounds,
                        "cutoffs": [str(CYCLE_START[7].date()), str(CYCLE_START[8].date())]}
    primary["test"] = {"cycle": 9, "cutoff": str(CYCLE_START[9].date())}
    primary["calibration"] = {"xgboost_calibrated": calibration_metrics(y9, s9["xgboost_calibrated"]),
                              "xgboost_raw": calibration_metrics(y9, s9["xgboost"]),
                              "reliability": reliability_table(y9, s9["xgboost_calibrated"])}

    # Concern 1: previously SAFE buildings (last cycle SAFE and still SAFE at cutoff) that turn UNSAFE.
    groups = {
        "previously_safe": (X9["last_status"] == 0) & (X9["status_at_cutoff"] <= 0),
        "previously_swarmp": X9["last_status"] == 1,
        "previously_unsafe": X9["last_status"] == 2,
        "no_prior_filing": X9["has_history"] == 0,
    }
    primary["subgroups"] = {}
    for name, mask in groups.items():
        m = mask.to_numpy()
        if m.sum() >= 200 and 0 < y9[m].sum() < m.sum():
            sub_scores = {k: v[m] for k, v in s9.items()}
            primary["subgroups"][name] = compare(y9[m], sub_scores, capacity_metric="precision@250")
    # Selection bias: filing timing (sub-cycle) and borough.
    primary["by_subcycle"] = {sc: ranking_metrics(y9[(lab9["subcycle"] == sc).to_numpy()],
                                                  s9["xgboost"][(lab9["subcycle"] == sc).to_numpy()])
                              for sc in ["A", "B", "C"]}
    primary["by_borough"] = {int(b): ranking_metrics(y9[(lab9["borough_code"] == b).to_numpy()],
                                                     s9["xgboost"][(lab9["borough_code"] == b).to_numpy()])
                             for b in sorted(lab9["borough_code"].dropna().unique())
                             if (lab9["borough_code"] == b).sum() >= 200}
    nf = never_filers(fac, 9)
    X_nf = feature_matrix(ctx, nf, CYCLE_START[9], 9)
    primary["never_filers"] = {
        "n_never_filed": int(len(nf)), "n_labeled": int(len(lab9)),
        "last_status_share_never_filers": X_nf["last_status"].value_counts(normalize=True).round(3).to_dict(),
        "last_status_share_labeled": X9["last_status"].value_counts(normalize=True).round(3).to_dict(),
        "mean_predicted_never_filers": float(calibrator.predict(final.predict_proba(X_nf)[:, 1]).mean()) if len(nf) else None,
    }
    contrib = final.get_booster().predict(xgb.DMatrix(X9), pred_contribs=True)[:, :-1]
    primary["mean_abs_shap"] = dict(sorted(zip(X9.columns, np.abs(contrib).mean(0).round(4).tolist()),
                                           key=lambda kv: -kv[1])[:15])
    report["primary_cycle9"] = primary

    # ---- Concern 3: DOB's published 2022 score, apples to apples ----------------------------------------
    dob = load_dob_facade_risk()
    common9 = lab9.index.intersection(dob.index)
    m9 = lab9.index.isin(common9)
    report["dob_cycle9_common_set"] = {
        "caveat": "DOB snapshot (2022-03-17) may have been built with cycle-9 information: NOT a fair comparison.",
        **compare(y9[m9], {**{k: v[m9] for k, v in s9.items()}, "dob_predprob_2022": dob.reindex(lab9.index[m9]).to_numpy()},
                  against=("dob_predprob_2022", "rule_prev_status")),
    }

    # Same information date as DOB: every system scores cycle-10 filers using only data before 2022-03-17.
    offset = DOB_FACADE_RISK_SNAPSHOT - CYCLE_START[9]
    vantage = {t: CYCLE_START[t - 1] + offset for t in (7, 8)}  # 2007-03-17 -> cycle 7, 2012-03-17 -> cycle 8
    dv7, dv8 = make_dataset(ctx, 7, vantage[7]), make_dataset(ctx, 8, vantage[8])
    fv, cv, lv, rv = fit_all([to_xy(dv7), to_xy(dv8)], to_xy(dv8))
    lab10 = build_labels(fac, 10)
    common10 = lab10.index.intersection(dob.index)
    X10v = feature_matrix(ctx, common10, DOB_FACADE_RISK_SNAPSHOT, 10)
    y10 = lab10.loc[common10, "y"].to_numpy()
    s10v = {**score_methods(X10v, fv, cv, lv), "dob_predprob_2022": dob.reindex(common10).to_numpy()}
    matched = compare(y10, s10v, against=("dob_predprob_2022", "rule_prev_status"))
    matched["design"] = {"information_date": str(DOB_FACADE_RISK_SNAPSHOT.date()), "outcome": "cycle-10 Initial filings",
                         "train_vantages": {str(t): str(v.date()) for t, v in vantage.items()}, "xgb_rounds": rv,
                         "caveat": "Cycle-10 filers so far are self-selected early filers (incomplete cycle)."}
    sub10 = lab10.loc[common10, "subcycle"].to_numpy()
    matched["by_subcycle"] = {sc: {name: ranking_metrics(y10[sub10 == sc], s[sub10 == sc])
                                   for name, s in s10v.items()}
                              for sc in ["A", "B", "C"] if (sub10 == sc).sum() >= 100}
    report["dob_matched_cycle10"] = matched

    # ---- Current capability: decision at the start of cycle 10 ------------------------------------------
    ft, ct, lt, rt = fit_all([to_xy(d7), to_xy(d8), to_xy(d9)], to_xy(d9))
    X10 = feature_matrix(ctx, lab10.index, CYCLE_START[10], 10)
    s10 = score_methods(X10, ft, ct, lt)
    current = compare(lab10["y"].to_numpy(), s10)
    current["caveat"] = "Incomplete cycle; early filers are not representative (see by_subcycle)."
    current["by_subcycle"] = {sc: ranking_metrics(lab10["y"].to_numpy()[(lab10["subcycle"] == sc).to_numpy()],
                                                  s10["xgboost"][(lab10["subcycle"] == sc).to_numpy()])
                              for sc in ["A", "B", "C"] if (lab10["subcycle"] == sc).sum() >= 100}
    # Selection check: since cycle 10, buildings that never filed cycle 9 may file early, enriching early filers
    # with delinquent buildings. Compare their share against the complete cycle 9, and score without them.
    y10_all = lab10["y"].to_numpy()
    nrf10 = (X10["nrf_prev_cycle"] == 1).to_numpy()
    current["prior_cycle_no_report_filed"] = {
        "share_cycle10_filers": float(nrf10.mean()),
        "share_cycle9_filers": float((X9["nrf_prev_cycle"] == 1).mean()),
        "unsafe_rate_with": float(y10_all[nrf10].mean()) if nrf10.any() else None,
        "unsafe_rate_without": float(y10_all[~nrf10].mean()),
    }
    representative = ((lab10["subcycle"] == "A").to_numpy()) & ~nrf10
    current["subcycle_A_excluding_prior_nrf"] = compare(y10_all[representative],
                                                       {k: v[representative] for k, v in s10.items()})
    report["current_cycle10_to_date"] = current
    report["run"]["seconds"] = round(time.time() - t0, 1)
    return report


def _fmt(v):
    return "—" if v is None or (isinstance(v, float) and np.isnan(v)) else (f"{v:.3f}" if isinstance(v, float) else str(v))


def write_markdown(report: dict) -> str:
    lines = [f"# Results — {report['label']}", "",
             f"Run on `{report['run']['machine']}` ({report['run']['platform']}), {report['run']['timestamp_utc']}, "
             f"{report['run'].get('seconds')} s", ""]

    def table(title, block, cols=("n", "base_rate", "pr_auc", "roc_auc", "precision@250", "precision@500",
                                  "precision@1000", "recall@500")):
        lines.extend([f"## {title}", "", "| method | " + " | ".join(cols) + " |", "|---" * (len(cols) + 1) + "|"])
        for name, m in block["metrics"].items():
            lines.append(f"| {name} | " + " | ".join(_fmt(m.get(c)) for c in cols) + " |")
        for name, boots in block.get("bootstrap", {}).items():
            for b in boots:
                lines.append(f"\n- {name} · {b['metric']}: {b['diff']:+.3f} (95% CI {b['ci95'][0]:+.3f} to {b['ci95'][1]:+.3f})")
        lines.append("")

    p = report["primary_cycle9"]
    table("Primary test: cycle 9 (cutoff 2020-02-21, trained on cycles 7–8)", p)
    for name, block in p["subgroups"].items():
        table(f"Cycle 9 subgroup: {name}", block)
    cal = p["calibration"]["xgboost_calibrated"]
    lines.extend([f"Calibration (cycle 9, Platt scaling fit on cycle 8): Brier {cal['brier']:.4f}, ECE {cal['ece']:.4f}, "
                  f"mean predicted {cal['mean_predicted']:.3f} vs observed {cal['observed_rate']:.3f}", "",
                  "By sub-cycle (xgboost): " + ", ".join(f"{k}: PR-AUC {_fmt(v['pr_auc'])} (base {_fmt(v['base_rate'])}, n={v['n']})"
                                                         for k, v in p["by_subcycle"].items()), "",
                  f"Never-filers in cycle 9: {p['never_filers']['n_never_filed']} vs {p['never_filers']['n_labeled']} labeled; "
                  f"last-status mix never-filers {p['never_filers']['last_status_share_never_filers']} vs labeled "
                  f"{p['never_filers']['last_status_share_labeled']} (-1 none, 0 SAFE, 1 SWARMP, 2 UNSAFE)", "",
                  "Top mean |SHAP|: " + ", ".join(f"{k} {v}" for k, v in p["mean_abs_shap"].items()), ""])
    table("Cycle 9 vs DOB 2022 score on the common set (DOB possibly in-sample — not a fair test)", report["dob_cycle9_common_set"])
    table("Matched information date 2022-03-17 → cycle-10 filers (fair DOB comparison)", report["dob_matched_cycle10"])
    cur = report["current_cycle10_to_date"]
    table("Current model (cutoff 2025-02-21) → cycle-10 filers to date (self-selected)", cur)
    nrf = cur["prior_cycle_no_report_filed"]
    lines.extend([f"Selection check: {nrf['share_cycle10_filers']:.1%} of cycle-10 filers so far had No Report Filed in cycle 9 "
                  f"(vs {nrf['share_cycle9_filers']:.1%} of cycle-9 filers for cycle 8); UNSAFE rate {nrf['unsafe_rate_with']:.3f} "
                  f"with vs {nrf['unsafe_rate_without']:.3f} without.", ""])
    table("Cycle-10 filers, sub-cycle A only, excluding prior No-Report-Filed (closest to representative)",
          cur["subcycle_A_excluding_prior_nrf"])
    return "\n".join(lines)


if __name__ == "__main__":
    rep = run()
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / "metrics.json").write_text(json.dumps(rep, indent=2, default=str))
    (REPORTS_DIR / "RESULTS.md").write_text(write_markdown(rep))
    print(write_markdown(rep))
