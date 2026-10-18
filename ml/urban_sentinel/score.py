"""Train the deployment model at today's vantage point and score every pending FISP building.

"Vantage-matched": live scores are produced partway through cycle 10 for buildings that have not filed yet,
so the model is trained (and backtested) on the same situation in earlier cycles, i.e. cutoff = cycle start +
the same elapsed time, restricted to buildings still pending at that cutoff.

Run from ml/:  python -m urban_sentinel.score [--refresh]
Writes data/outputs/buildings_scores.json (+ contract/sample_buildings.json when --sample).
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import evidence, socrata
from .artifacts import DeployedModel, encode_missing, save_deployment_model
from .config import CYCLE_START, ML_DIR, OUTPUT_DIR, cycle_at, subcycle_deadline
from .evaluation import ranking_metrics
from .experiments import fit_all
from .features import build_features
from .featureset import Context, feature_matrix
from .ingest import facade_bbls, load_pluto
from .labels import build_labels
from .models import rule_score

STATUS_NAME = {-1: "none on record", 0: "SAFE", 1: "SWARMP", 2: "UNSAFE"}
BOROUGH_NAME = {1: "Manhattan", 2: "Bronx", 3: "Brooklyn", 4: "Queens", 5: "Staten Island"}
TARGET_TEXT = "Probability that the building's next Initial FISP filing (cycle {c}) records an UNSAFE façade"
TIERS = [(0.05, "high"), (0.20, "elevated"), (0.60, "typical"), (1.01, "low")]  # by rank percentile among pending

_yes = lambda v: "yes" if v >= 0.5 else "no"
FEATURE_TEXT = {
    "status_at_cutoff": ("Status on record now", lambda v: STATUS_NAME[int(v)]),
    "last_status": ("Last cycle's inspection result", lambda v: STATUS_NAME[int(v)]),
    "prev_status": ("Result two filed cycles ago", lambda v: STATUS_NAME[int(v)]),
    "years_since_last_filing": ("Years since last façade filing", lambda v: f"{v:.1f}"),
    "days_vs_deadline_last": ("Last report filed vs its deadline", lambda v: f"{abs(v):.0f} days {'late' if v > 0 else 'early'}"),
    "cycles_since_last": ("Cycles since last report", lambda v: f"{v:.0f}"),
    "n_cycles_filed": ("Past cycles with a report", lambda v: f"{v:.0f}"),
    "n_unsafe": ("Past cycles rated UNSAFE", lambda v: f"{v:.0f}"),
    "n_swarmp": ("Past cycles rated SWARMP", lambda v: f"{v:.0f}"),
    "n_safe": ("Past cycles rated SAFE", lambda v: f"{v:.0f}"),
    "frac_unsafe": ("Share of past cycles UNSAFE", lambda v: f"{v:.0%}"),
    "unsafe_streak": ("Consecutive UNSAFE cycles", lambda v: f"{v:.0f}"),
    "n_nrf_cycles": ("Cycles with no report filed", lambda v: f"{v:.0f}"),
    "nrf_prev_cycle": ("Missed last cycle's report", _yes),
    "repaired_since_last": ("Repairs certified since last UNSAFE", _yes),
    "n_amended_last": ("Amended reports last cycle", lambda v: f"{v:.0f}"),
    "n_subsequent_last": ("Subsequent reports last cycle", lambda v: f"{v:.0f}"),
    "n_initial_last_cycle": ("Initial reports last cycle", lambda v: f"{v:.0f}"),
    "has_history": ("Has earlier FISP filings", _yes),
    "borough_code": ("Borough", lambda v: BOROUGH_NAME.get(int(v), "unknown")),
    "subcycle_code": ("Filing sub-cycle", lambda v: "ABC"[int(v)]),
}


SOURCE_TEXT = {"dob": "DOB violations", "ecb": "ECB violations", "cmp": "DOB complaints"}
GROUP_TEXT = {"facade": "façade / Local Law 11", "fisp_compliance": "FISP filing compliance", "structural": "unsafe building",
              "wall": "failure to maintain walls", "report": "façade report not filed", "unsafe_measures": "unsafe-façade enforcement",
              "shed": "sidewalk shed"}
BLDG_TEXT = {"bldg_age": ("Building age (years)", lambda v: f"{v:.0f}"), "num_floors": ("Floors", lambda v: f"{v:.0f}"),
             "lot_area": ("Tax-lot size, sq ft (very large = multi-building development)", lambda v: f"{np.expm1(v):,.0f}"), "historic_district": ("In a historic district", _yes),
             "landmark": ("Designated landmark", _yes)}


def _describe(feature: str, value: float) -> tuple[str, str]:
    src = feature.split("_", 1)[0]
    if src in SOURCE_TEXT:
        rest = feature[len(src) + 1:]
        for suffix, text in [("_years_since", "years since last"), ("_ever", "all prior"), ("_5y", "past 5 years"),
                             ("_1y", "past year")]:
            if rest.endswith(suffix):
                group = GROUP_TEXT.get(rest[: -len(suffix)], rest[: -len(suffix)].replace("_", " "))
                if suffix == "_years_since":
                    return f"{SOURCE_TEXT[src]} ({group}): {text}", ("none" if pd.isna(value) else f"{value:.1f}")
                return f"{SOURCE_TEXT[src]} ({group}), {text}", f"{value:.0f}"
    if feature in BLDG_TEXT:
        label, fmt = BLDG_TEXT[feature]
        return label, ("unknown" if pd.isna(value) else fmt(value))
    if feature.startswith("class_"):
        return f"Building class: {feature[6:].replace('_', ' ')}", _yes(value)
    if feature.startswith("wall_"):
        return f"Façade includes {feature[5:].replace('_', ' ')}", _yes(value)
    label, fmt = FEATURE_TEXT.get(feature, (feature, lambda v: f"{v:g}"))
    return label, ("unknown" if pd.isna(value) else fmt(value))


def vantage_dataset(ctx: Context, target_cycle: int, elapsed: pd.Timedelta):
    cutoff = CYCLE_START[target_cycle] + elapsed
    labels = build_labels(ctx.fac, target_cycle)
    labels = labels[labels["first_filed_on"] >= cutoff]  # still pending at the cutoff
    return feature_matrix(ctx, labels.index, cutoff, target_cycle), labels


def train_vantage_model(ctx: Context, now: pd.Timestamp):
    current = cycle_at(now)
    elapsed = now - CYCLE_START[current]
    data = {t: vantage_dataset(ctx, t, elapsed) for t in (current - 3, current - 2, current - 1)}
    xy = {t: (encode_missing(X), lab["y"]) for t, (X, lab) in data.items()}  # NaN-free: NNPA-servable
    t1, t2, t3 = sorted(xy)
    # Backtest at the same vantage: train on the two earlier cycles, test on the latest complete one.
    bt_model, bt_cal, bt_logit, _ = fit_all([xy[t1], xy[t2]], xy[t2])
    X3, lab3 = data[t3]
    raw3 = bt_model.predict_proba(encode_missing(X3))[:, 1]
    prev_safe = ((X3["last_status"] == 0) & (X3["status_at_cutoff"] <= 0)).to_numpy()
    backtest = {
        "train_cycles": [t1, t2], "test_cycle": t3, "elapsed_days": elapsed.days,
        "test_cutoff": str((CYCLE_START[t3] + elapsed).date()),
        "xgboost": ranking_metrics(lab3["y"], raw3),
        "rule_prev_status": ranking_metrics(lab3["y"], rule_score(X3)),
        "previously_safe_xgboost": ranking_metrics(lab3["y"].to_numpy()[prev_safe], raw3[prev_safe]),
    }
    final, calibrator, _, rounds = fit_all([xy[t1], xy[t2], xy[t3]], xy[t3])
    meta = save_deployment_model(final, calibrator, train_cycles=[t1, t2, t3], calibration_cycle=t3,
                                 xgb_rounds=rounds, test_summary=backtest)
    return meta, backtest


def fisp_history(fac: pd.DataFrame) -> dict[str, list[dict]]:
    """Per building and cycle: the worst Initial status, first filing date and the TR6 report number of the
    filing that carries that status (so the frontend can link to the exact official record)."""
    ini = fac[fac["filing_type"].eq("Initial") & fac["severity"].notna()]
    ini = ini.sort_values(["bin", "cycle", "severity", "observed_on"], ascending=[True, True, False, True])
    per = (ini.groupby(["bin", "cycle"]).agg(sev=("severity", "first"), reference=("tr6_no", "first"),
                                             filed=("observed_on", "min"))
           .reset_index().sort_values(["bin", "cycle"]))
    return {b: [{"cycle": int(r.cycle), "status": STATUS_NAME[int(r.sev)],
                 "filed_on": None if pd.isna(r.filed) else str(r.filed.date()),
                 "reference": r.reference if isinstance(r.reference, str) else None} for r in g.itertuples()]
            for b, g in per.groupby("bin")}


def build_records(ctx: Context, model: DeployedModel, now: pd.Timestamp, pluto: pd.DataFrame | None) -> list[dict]:
    current = cycle_at(now)
    fac = ctx.fac
    seen = fac[(fac["observed_on"] <= now) | fac["observed_on"].isna()]
    # In the program = any FISP record in the current or previous two cycles. (Requiring cycle 9/10 activity
    # dropped buildings such as 7 World Trade Center whose last filing was cycle 8.)
    universe = pd.Index(sorted(set(seen.loc[seen["cycle"] >= current - 2, "bin"])), name="bin")
    filed_now = build_labels(seen, current)
    pending = universe.difference(filed_now.index)

    features = model.meta["features"]
    X = feature_matrix(ctx, pending, now, current)[features]
    raw, prob, contrib = model.predict(X)
    order = np.argsort(-raw, kind="stable")
    rank = np.empty(len(raw), int)
    rank[order] = np.arange(1, len(raw) + 1)
    pct = rank / len(raw)
    X_at_now = X

    history = fisp_history(seen)
    latest = seen.sort_values("observed_on").groupby("bin").tail(1).set_index("bin")
    bbls = facade_bbls(seen)
    status_now = build_features(seen, universe, now, current + 1)["status_at_cutoff"]
    prov = socrata.read_provenance("facades") or {}
    fp = evidence.fingerprint()
    scored_at = datetime.now(timezone.utc).isoformat()
    pos = {b: i for i, b in enumerate(pending)}

    records = []
    for b in universe:
        row = latest.loc[b]
        sub = row["subcycle"] if isinstance(row["subcycle"], str) else None
        bbl = bbls.get(b)
        loc = pluto.loc[bbl] if pluto is not None and bbl in pluto.index else None
        missing = []
        lat = lon = None
        if loc is not None and pd.notna(loc["latitude"]):
            lat, lon = float(loc["latitude"]), float(loc["longitude"])
        else:
            missing.append("location")
        rec = {
            "bin": b, "bbl": bbl,
            "address": " ".join(str(v) for v in [row.get("house_no"), row.get("street_name")] if pd.notna(v)).strip() or None,
            "borough": BOROUGH_NAME.get(row["borough_code"]) if pd.notna(row["borough_code"]) else None,
            "lat": lat, "lon": lon,
            "fisp": {
                "subcycle": sub,
                "current_cycle": current,
                "filing_window_closes": str(subcycle_deadline(current, sub).date()) if sub else None,
                "status_on_record": STATUS_NAME[int(status_now.get(b, -1))],
                "current_cycle_filed": bool(b in filed_now.index),
                "current_cycle_status": (STATUS_NAME[int(filed_now.loc[b, "worst_severity"])] if b in filed_now.index else None),
                "history": history.get(b, []),
            },
            "prediction": None, "drivers": [],
            "provenance": {"facades": {"dataset": "xubg-57si", "rows_updated_at": prov.get("rows_updated_at"),
                                       "fetched_at": prov.get("fetched_at")},
                           "location": "NYC PLUTO (64uk-42ks) lot centroid" if lat is not None else None},
            "missing": missing,
        }
        if b in pos:
            i = pos[b]
            rec["prediction"] = {
                "target": TARGET_TEXT.format(c=current), "probability": round(float(prob[i]), 4),
                "rank": int(rank[i]), "of": int(len(raw)), "percentile": round(float(pct[i]), 4),
                "tier": next(name for cut, name in TIERS if pct[i] <= cut),
                "model_version": model.meta["model_sha256"], "scored_at": scored_at,
                "scored_on": {"machine": fp["machine"], "byteorder": fp["byteorder"]},
            }
            top = np.argsort(-np.abs(contrib[i]))[:3]
            rec["drivers"] = [{"feature": features[j],
                               "label": _describe(features[j], X_at_now.iat[i, j])[0],
                               "value": _describe(features[j], X_at_now.iat[i, j])[1],
                               "effect": "raises" if contrib[i, j] > 0 else "lowers",
                               "log_odds": round(float(contrib[i, j]), 3)} for j in top]
            if not history.get(b):
                rec["missing"].append("no prior FISP filing (prediction relies on location only)")
        records.append(rec)
    return records


def run(refresh: bool = False, write_sample: bool = False, now: pd.Timestamp | None = None) -> dict:
    t0 = time.time()
    now = pd.Timestamp.now().normalize() if now is None else pd.Timestamp(now)
    ctx = Context.load(refresh=refresh)
    meta, backtest = train_vantage_model(ctx, now)
    t_train = time.time() - t0
    model = DeployedModel.load()
    pluto = load_pluto(facade_bbls(ctx.fac), refresh=refresh)
    t1 = time.time()
    records = build_records(ctx, model, now, pluto)
    t_score = time.time() - t1
    pending = [r for r in records if r["prediction"]]
    out_meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(), "as_of": str(now.date()),
        "n_buildings": len(records), "n_pending_scored": len(pending),
        "label": TARGET_TEXT.format(c=cycle_at(now)), "model": {k: meta[k] for k in ("model_sha256", "train_cycles", "xgb_rounds")},
        "backtest_same_vantage": backtest, "run": {**evidence.fingerprint(), "train_seconds": round(t_train, 1),
                                                    "score_seconds": round(t_score, 2)},
        "tiers": "rank percentile among pending buildings: high ≤5%, elevated ≤20%, typical ≤60%, low otherwise",
        "caveats": ["Recorded inspection outcome, not structural-collapse risk.",
                    "Label exists only for buildings that file; never-filers are missing not at random.",
                    "Locations are PLUTO lot centroids (shared by buildings on one lot)."],
    }
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "buildings_scores.json").write_text(json.dumps({"meta": out_meta, "buildings": records}, default=str))
    (OUTPUT_DIR / "score_meta.json").write_text(json.dumps(out_meta, indent=2, default=str))
    if write_sample:
        write_contract_sample(records, out_meta)
    return out_meta


def write_contract_sample(records: list[dict], meta: dict, n: int = 20) -> None:
    pending = sorted((r for r in records if r["prediction"]), key=lambda r: r["prediction"]["rank"])
    prev_safe = [r for r in pending if r["fisp"]["status_on_record"] == "SAFE"]
    no_hist = [r for r in pending if not r["fisp"]["history"]]
    filed_unsafe = [r for r in records if r["fisp"]["current_cycle_status"] == "UNSAFE"]
    low = pending[-3:]
    picks, seen = [], set()
    for group in (pending[:6], prev_safe[:4], no_hist[:2], filed_unsafe[:4], low, pending[len(pending) // 2:][:1]):
        for r in group:
            if r["bin"] not in seen and len(picks) < n:
                picks.append(r)
                seen.add(r["bin"])
    contract_dir = ML_DIR / "contract"
    contract_dir.mkdir(exist_ok=True)
    sample_meta = {k: meta[k] for k in ("generated_at", "as_of", "label", "model", "tiers", "caveats")}
    (contract_dir / "sample_buildings.json").write_text(json.dumps({"meta": sample_meta, "buildings": picks},
                                                                  indent=2, default=str))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download source data before scoring")
    ap.add_argument("--sample", action="store_true", help="also write ml/contract/sample_buildings.json")
    args = ap.parse_args()
    result = run(refresh=args.refresh, write_sample=args.sample)
    print(json.dumps({k: result[k] for k in ("as_of", "n_buildings", "n_pending_scored", "model", "run")}, indent=2))
    bt = result["backtest_same_vantage"]
    print("backtest", bt["test_cycle"], "xgb", round(bt["xgboost"]["pr_auc"], 3), "rule", round(bt["rule_prev_status"]["pr_auc"], 3),
          "base", round(bt["xgboost"]["base_rate"], 3), "n", bt["xgboost"]["n"])
