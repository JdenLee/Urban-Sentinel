"""Leakage audit: quantify what the excluded per-row penalty fields would add.

The façade dataset's late_filing_amt / failure_to_file_amt / failure_to_correct_amt have no posting date and
are updated after filing, so they cannot be placed before a cutoff. If adding them produces an implausibly
large jump on the cycle-9 test, they encode post-cutoff outcomes and must stay excluded.
Run from ml/:  python -m urban_sentinel.audit_leakage
"""
from __future__ import annotations

import json

import pandas as pd

from . import socrata
from .config import CYCLE_START, DATASETS, REPORTS_DIR
from .evaluation import ranking_metrics
from .experiments import make_dataset
from .ingest import load_facades
from .models import fit_xgb

PENALTY_FIELDS = ["late_filing_amt", "failure_to_file_amt", "failure_to_correct_amt"]


def run() -> dict:
    pen = socrata.cached_query("facades_penalties_audit", DATASETS["facades"],
                               select="bin,cycle,submitted_on," + ",".join(PENALTY_FIELDS))
    for col in PENALTY_FIELDS:
        pen[col] = pd.to_numeric(pen[col], errors="coerce").fillna(0)
    pen["cycle"] = pd.to_numeric(pen["cycle"], errors="coerce")
    pen["submitted_on"] = pd.to_datetime(pen["submitted_on"], errors="coerce")

    def with_penalties(X, target):
        rows = pen[(pen["cycle"] == target - 1) & (pen["submitted_on"] < CYCLE_START[target])]
        X = X.copy()
        for col in PENALTY_FIELDS:
            X[f"prev_cycle_{col}"] = rows.groupby("bin")[col].sum().reindex(X.index).fillna(0)
        return X

    fac = load_facades()
    data = {t: make_dataset(fac, t) for t in (7, 8, 9)}
    out = {}
    for name, transform in [("strict", lambda X, t: X), ("strict_plus_penalty_fields", with_penalties)]:
        Xs = {t: transform(data[t][0], t) for t in data}
        probe = fit_xgb(Xs[7], data[7][1]["y"], Xs[8], data[8][1]["y"])
        final = fit_xgb(pd.concat([Xs[7], Xs[8]]), pd.concat([data[7][1]["y"], data[8][1]["y"]]),
                        n_estimators=round((probe.best_iteration + 1) * 1.15))
        out[name] = ranking_metrics(data[9][1]["y"], final.predict_proba(Xs[9])[:, 1])
    out["conclusion"] = ("Penalty fields raise cycle-9 PR-AUC from {:.3f} to {:.3f}; with no posting date this "
                         "is treated as post-cutoff leakage and the fields are excluded."
                         ).format(out["strict"]["pr_auc"], out["strict_plus_penalty_fields"]["pr_auc"])
    return out


if __name__ == "__main__":
    result = run()
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / "leakage_audit.json").write_text(json.dumps(result, indent=2))
    print(result["conclusion"])
