"""Frontend payload: real (LinuxONE-generated) building scores for a map area, in the shape the 3D app's loader
accepts (frontend/src/data/loadPredictions.ts → parseMlServiceRecord), plus a cycle-9 prediction-vs-actual
backtest for the same area.

Served live by GET /predictions?bbox=... and exportable as a static snapshot for offline demo reliability:
  python -m urban_sentinel.export_frontend --out ../data/outputs/linuxone-predictions.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from .config import CYCLE_START, DATA_DIR, OUTPUT_DIR, REPORTS_DIR

# Frontend demo area (bounds of frontend/public/data/buildings-demo.geojson, Lower Manhattan).
LOWER_MANHATTAN_BBOX = (-74.0191, 40.7004, -73.9716, 40.7351)
GROUND_MOTION_FILE = OUTPUT_DIR / "insar_ground_motion.geojson"
BACKTEST_FILE = OUTPUT_DIR / "cycle9_backtest.json"


def in_bbox(rec: dict, bbox) -> bool:
    return rec["lat"] is not None and bbox[0] <= rec["lon"] <= bbox[2] and bbox[1] <= rec["lat"] <= bbox[3]


def model_card() -> dict:
    """Real evaluation numbers (reports/metrics.json) in the frontend's model-card shape."""
    card = {
        "target": "Probability that the building's next Initial FISP façade filing records an UNSAFE condition "
                  "(a licensed inspector's recorded result, not structural-collapse risk).",
        "score_definition": "Calibrated probability (Platt scaling) from gradient-boosted trees on façade filing "
                            "history, DOB and ECB violations and building attributes, using only records available "
                            "before the decision date.",
        "metrics": [],
        "limitations": [
            "Ranks buildings for proactive inspection; it does not certify safety or predict collapse.",
            "Only buildings that file have outcomes; never-filers are missing not at random.",
            "PLUTO building attributes are a 2026 snapshot (age/floors/lot are near-static).",
            "Satellite ground motion was tested and did not improve the model; it is shown as a separate layer.",
        ],
    }
    path = REPORTS_DIR / "metrics.json"
    if path.exists():
        r = json.loads(path.read_text())
        p = r["primary_cycle9"]["metrics"]
        safe = r["primary_cycle9"]["subgroups"]["previously_safe"]["metrics"]
        card["metrics"] = [
            {"label": "Cycle-9 test PR-AUC (model vs last-status rule)",
             "value": f"{p['xgboost']['pr_auc']:.3f} vs {p['rule_prev_status']['pr_auc']:.3f}"},
            {"label": "Precision in top 500 (model vs rule; base rate)",
             "value": f"{p['xgboost']['precision@500']:.1%} vs {p['rule_prev_status']['precision@500']:.1%}; "
                      f"{p['xgboost']['base_rate']:.1%}"},
            {"label": "Previously-SAFE buildings: precision in top 250 (base rate)",
             "value": f"{safe['xgboost']['precision@250']:.1%} ({safe['xgboost']['base_rate']:.1%})"},
            {"label": "Backtest sample size (cycle 9)", "value": f"{p['xgboost']['n']:,} buildings"},
        ]
    return card


def ground_motion_meta() -> dict | None:
    if not GROUND_MOTION_FILE.exists():
        return None
    meta = json.loads(GROUND_MOTION_FILE.read_text()).get("metadata", {})
    return {"measurement": "Line-of-sight (LOS) velocity relative to ~2 km surroundings", "units": "mm/yr",
            "source": "NASA OPERA DISP-S1 (Sentinel-1), frame F08622", "posting_m": 30, "aggregation_m": 60,
            "period_start": meta.get("observation_start", "2016-09-26"),
            "period_end": meta.get("observation_end", "2020-02-14"), "metadata": meta}


def frontend_payload(records: list[dict], score_meta: dict, bbox=LOWER_MANHATTAN_BBOX) -> dict:
    area = [r for r in records if r["prediction"] and in_bbox(r, bbox)]
    area.sort(key=lambda r: r["prediction"]["rank"])
    buildings = []
    for i, r in enumerate(area, start=1):
        pred = {**r["prediction"], "citywide_rank": r["prediction"]["rank"], "rank": i, "of": len(area)}
        buildings.append({**r, "prediction": pred})
    machine = (area[0]["prediction"]["scored_on"]["machine"] if area else None)
    payload = {
        "schema_version": "ml-service-1",
        "data_mode": "real",
        "generated_at": score_meta["generated_at"],
        "data_as_of": score_meta["as_of"],
        "model": {"name": "facade-unsafe-xgboost", "version": score_meta["model"]["model_sha256"],
                  "execution_platform": "IBM LinuxONE (s390x)" if machine == "s390x" else machine,
                  "trained_through": f"FISP cycle {max(score_meta['model']['train_cycles'])}",
                  "train_cycles": score_meta["model"]["train_cycles"]},
        "model_card": model_card(),
        "bbox": list(bbox),
        "rank_scope": "rank is within this map area; prediction.citywide_rank is across all pending FISP buildings",
        "meta": {k: score_meta[k] for k in ("label", "tiers", "caveats", "backtest_same_vantage")},
        "buildings": buildings,
    }
    gm = ground_motion_meta()
    if gm:
        payload["movement"] = gm
    if BACKTEST_FILE.exists():
        bt = json.loads(BACKTEST_FILE.read_text())
        payload["backtest_cycle9"] = {**{k: v for k, v in bt.items() if k != "buildings"},
                                      "buildings": [b for b in bt["buildings"] if b["lat"] is not None
                                                    and bbox[0] <= b["lon"] <= bbox[2] and bbox[1] <= b["lat"] <= bbox[3]]}
    return payload


def cycle9_backtest() -> dict:
    """Out-of-time predictions for every cycle-9 filer (model trained on cycles 7-8 only, features as of
    2020-02-21) next to the outcome actually recorded in cycle 9."""
    from .experiments import fit_all, make_dataset
    from .featureset import Context
    from .ingest import facade_bbls, load_pluto

    ctx = Context.load()
    d7, d8, d9 = (make_dataset(ctx, t) for t in (7, 8, 9))
    model, cal, _, _ = fit_all([(d7[0], d7[1]["y"]), (d8[0], d8[1]["y"])], (d8[0], d8[1]["y"]))
    X9, lab9 = d9
    prob = cal.predict(model.predict_proba(X9)[:, 1])
    order = np.argsort(-prob, kind="stable")
    rank = np.empty(len(prob), int)
    rank[order] = np.arange(1, len(prob) + 1)
    bbls = facade_bbls(ctx.fac).reindex(X9.index)
    pluto = load_pluto(facade_bbls(ctx.fac))
    loc = pluto.reindex(bbls.to_numpy())
    status = {0: "SAFE", 1: "SWARMP", 2: "UNSAFE"}
    prev = {-1: "none", 0: "SAFE", 1: "SWARMP", 2: "UNSAFE"}
    rows = []
    for i, b in enumerate(X9.index):
        lat, lon = loc["latitude"].iat[i], loc["longitude"].iat[i]
        rows.append({"bin": b, "lat": None if pd.isna(lat) else round(float(lat), 6),
                     "lon": None if pd.isna(lon) else round(float(lon), 6),
                     "predicted_probability": round(float(prob[i]), 4), "predicted_rank": int(rank[i]),
                     "actual_status": status[int(lab9["worst_severity"].iat[i])],
                     "actual_unsafe": int(lab9["y"].iat[i]),
                     "status_before_cutoff": prev[int(X9["status_at_cutoff"].iat[i])],
                     "filed_on": str(lab9["first_filed_on"].iat[i].date())})
    y = lab9["y"].to_numpy()
    deciles = pd.qcut(pd.Series(prob).rank(method="first"), 10, labels=False)
    by_decile = (pd.DataFrame({"decile": 10 - deciles, "y": y, "p": prob}).groupby("decile")
                 .agg(predicted=("p", "mean"), actual_unsafe_rate=("y", "mean"), n=("y", "size")).round(4)
                 .reset_index().to_dict(orient="records"))
    return {"design": "Model trained on FISP cycles 7-8 only; features as of 2020-02-21; outcome = cycle-9 Initial filing",
            "cutoff": str(CYCLE_START[9].date()), "n": int(len(rows)), "base_rate": float(y.mean()),
            "by_decile": by_decile, "buildings": rows}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUTPUT_DIR / "linuxone-predictions.json"))
    ap.add_argument("--with-backtest", action="store_true", help="(re)compute the cycle-9 prediction-vs-actual layer")
    args = ap.parse_args()
    if args.with_backtest or not BACKTEST_FILE.exists():
        BACKTEST_FILE.parent.mkdir(parents=True, exist_ok=True)
        BACKTEST_FILE.write_text(json.dumps(cycle9_backtest()))
    scores = json.loads((OUTPUT_DIR / "buildings_scores.json").read_text())
    payload = frontend_payload(scores["buildings"], scores["meta"])
    Path(args.out).write_text(json.dumps(payload, separators=(",", ":"), default=str))
    print(f"wrote {args.out}: {len(payload['buildings'])} buildings in area, platform "
          f"{payload['model']['execution_platform']}, backtest rows "
          f"{len(payload.get('backtest_cycle9', {}).get('buildings', []))}, movement layer {'yes' if 'movement' in payload else 'no'}")


if __name__ == "__main__":
    main()
