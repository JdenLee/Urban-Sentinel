"""Step 2: does each additional municipal source improve the cycle-9 test beyond façade history?

Same split as the primary test (train cycles 7-8, test cycle 9, cutoff = cycle start). A source is worth keeping
only if its paired-bootstrap CI vs façade-only excludes zero (overall or for previously-SAFE buildings).
Run from ml/:  python -m urban_sentinel.ablation
"""
from __future__ import annotations

import json

import pandas as pd

from .config import CYCLE_START, REPORTS_DIR
from .evaluation import paired_bootstrap, ranking_metrics
from .experiments import fit_all, make_dataset
from .featureset import Context, extra_features

VARIANTS = {
    "facade_only": (),
    "+dob_violations": ("dob",),
    "+ecb_violations": ("ecb",),
    "+complaints": ("cmp",),
    "+building_attributes": ("bldg",),
    "+dob+ecb (no PLUTO snapshot)": ("dob", "ecb"),
    "+dob+ecb+building (deployed)": ("dob", "ecb", "bldg"),
    "+all": ("dob", "ecb", "cmp", "bldg"),
    "+all_echo_buffer_90d": ("dob", "ecb", "cmp", "bldg", "buffer"),
}


def run() -> dict:
    ctx = Context.load()
    base = {t: make_dataset(ctx.fac, t) for t in (7, 8, 9)}  # façade-only base
    X9 = base[9][0]
    y9 = base[9][1]["y"].to_numpy()
    prev_safe = ((X9["last_status"] == 0) & (X9["status_at_cutoff"] <= 0)).to_numpy()
    scores, out = {}, {"design": "train cycles 7-8, test cycle 9 at cutoff 2020-02-21", "variants": {}}
    for name, parts in VARIANTS.items():
        sets = {}
        for t, (X, lab) in base.items():
            extra = extra_features(ctx, X.index, CYCLE_START[t], parts)
            sets[t] = (pd.concat([X, extra], axis=1), lab["y"])
        model, _, _, rounds = fit_all([sets[7], sets[8]], sets[8])
        s = model.predict_proba(sets[9][0])[:, 1]
        scores[name] = s
        out["variants"][name] = {"n_features": int(sets[9][0].shape[1]), "xgb_rounds": rounds,
                                 "all": ranking_metrics(y9, s), "previously_safe": ranking_metrics(y9[prev_safe], s[prev_safe])}
        if name != "facade_only":
            ref = scores["facade_only"]
            out["variants"][name]["vs_facade_only"] = {
                "all_pr_auc": paired_bootstrap(y9, s, ref, "pr_auc"),
                "all_precision@500": paired_bootstrap(y9, s, ref, "precision@500"),
                "prev_safe_pr_auc": paired_bootstrap(y9[prev_safe], s[prev_safe], ref[prev_safe], "pr_auc"),
                "prev_safe_precision@250": paired_bootstrap(y9[prev_safe], s[prev_safe], ref[prev_safe], "precision@250"),
            }
        if name == "+all":
            imp = pd.Series(model.get_booster().get_score(importance_type="gain")).sort_values(ascending=False)
            out["variants"][name]["top_gain"] = imp.head(15).round(2).to_dict()
        print(name, {k: round(v, 3) for k, v in out["variants"][name]["all"].items() if k in ("pr_auc", "precision@500")},
              "prevSAFE", {k: round(v, 3) for k, v in out["variants"][name]["previously_safe"].items() if k in ("pr_auc", "precision@250")})
    return out


def write_markdown(out: dict) -> str:
    lines = ["# Step 2 — source ablations (cycle-9 test)", "", out["design"], "",
             "| variant | features | PR-AUC | P@500 | prev-SAFE PR-AUC | prev-SAFE P@250 | Δ PR-AUC vs façade (95% CI) | Δ prev-SAFE P@250 (95% CI) |",
             "|---|---|---|---|---|---|---|---|"]
    for name, v in out["variants"].items():
        d = v.get("vs_facade_only")
        fmt = lambda b: f"{b['diff']:+.3f} ({b['ci95'][0]:+.3f}, {b['ci95'][1]:+.3f})"
        lines.append(f"| {name} | {v['n_features']} | {v['all']['pr_auc']:.3f} | {v['all']['precision@500']:.3f} | "
                     f"{v['previously_safe']['pr_auc']:.3f} | {v['previously_safe']['precision@250']:.3f} | "
                     f"{fmt(d['all_pr_auc']) if d else '—'} | {fmt(d['prev_safe_precision@250']) if d else '—'} |")
    if "top_gain" in out["variants"].get("+all", {}):
        lines += ["", "Top features by gain (+all): " + ", ".join(f"{k} {v}" for k, v in out["variants"]["+all"]["top_gain"].items())]
    return "\n".join(lines)


if __name__ == "__main__":
    result = run()
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / "ablation.json").write_text(json.dumps(result, indent=2, default=str))
    (REPORTS_DIR / "ABLATION.md").write_text(write_markdown(result))
    print(write_markdown(result))
