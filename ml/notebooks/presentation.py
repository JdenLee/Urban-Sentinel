"""Notebook orchestration. Production model functions remain the source of truth.

Import this module before urban_sentinel and call configure() in a fresh kernel.
No network requests or training take place on import.
"""
from __future__ import annotations

import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import time
import warnings
from datetime import datetime, timezone


def check_dependencies():
    missing = []
    for module in ("numpy", "pandas", "sklearn", "xgboost", "matplotlib", "IPython"):
        try:
            importlib.import_module(module)
        except Exception:  # Native libraries can raise package-specific errors (e.g. OpenMP).
            missing.append(module)
    if missing:
        raise RuntimeError("Missing or incompatible notebook packages: " + ", ".join(missing)
                           + ". Follow ml/notebooks/README.md (including OpenMP), select that Python kernel, and restart.") from None


def configure(repo: Path, run_dir: Path):
    repo, run_dir = repo.resolve(), run_dir.resolve()
    if not run_dir.is_relative_to(repo / "data" / "presentation"):
        raise ValueError("Presentation runs must live under this checkout's data/presentation/.")
    if "urban_sentinel.config" in sys.modules:
        raise RuntimeError("Restart the kernel before configuring a presentation run; model paths are already loaded.")
    run_dir.mkdir(parents=True, exist_ok=True)
    os.environ["URBAN_SENTINEL_DATA_DIR"] = str(run_dir)
    os.environ["URBAN_SENTINEL_REPORTS_DIR"] = str(run_dir / "reports")
    sys.path.insert(0, str(repo / "ml"))
    check_dependencies()
    from urban_sentinel import evidence
    from urban_sentinel.config import REPORTS_DIR
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"started_at": datetime.now(timezone.utc).isoformat(),
                "platform": evidence.fingerprint(), "status": "configured"}
    save_json(run_dir / "presentation_manifest.json", manifest)
    return manifest


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, default=str) + "\n")


def file_hashes(folder):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(Path(folder).glob("*")) if p.is_file()}


def prepare_data():
    """Acquire each municipal source once; downstream steps use this frozen cache."""
    import pandas as pd
    from urban_sentinel.config import DATA_DIR, RAW_DIR
    from urban_sentinel.featureset import Context
    from urban_sentinel.ingest import facade_bbls, load_pluto, load_dob_facade_risk, valid_bin

    receipt = DATA_DIR / "prepared.json"
    if receipt.exists():
        previous = json.loads(receipt.read_text())
        if previous["raw_sha256"] != file_hashes(RAW_DIR):
            raise RuntimeError("The prepared snapshot changed. Restart with a new RUN_ID to acquire a consistent snapshot.")
        ctx = Context.load()
        pluto = load_pluto(facade_bbls(ctx.fac))
    else:
        print("Downloading façade filings, DOB / ECB violations, complaints, PLUTO and the DOB benchmark…", flush=True)
        try:
            ctx = Context.load(refresh=True)
            pluto = load_pluto(facade_bbls(ctx.fac), refresh=True)
            load_dob_facade_risk(refresh=True)
        except Exception:
            raise RuntimeError("Data preparation did not finish. Check internet access to NYC Open Data and "
                               "raw.githubusercontent.com, then rerun this cell. No completed snapshot was saved.") from None
        save_json(receipt, {"completed_at": datetime.now(timezone.utc).isoformat(),
                           "raw_sha256": file_hashes(RAW_DIR)})
    raw = pd.read_csv(RAW_DIR / "facades.csv.gz", dtype=str, keep_default_na=False, na_values=[""])
    valid = valid_bin(raw["bin"])
    valid_cycle = pd.to_numeric(raw["cycle"], errors="coerce").notna()
    audit = pd.DataFrame([
        ("Downloaded filing rows", len(raw)),
        ("Removed invalid / placeholder BINs", int((~valid).sum())),
        ("Removed missing / invalid cycles after BIN check", int((valid & ~valid_cycle).sum())),
        ("Retained filing rows", len(ctx.fac)),
        ("Retained rows without an observable date", int(ctx.fac.observed_on.isna().sum())),
        ("Distinct building BINs", ctx.fac.bin.nunique()),
    ], columns=["Preparation step", "Rows / buildings"])
    assert len(raw) - int((~valid).sum()) - int((valid & ~valid_cycle).sum()) == len(ctx.fac)
    return {"context": ctx, "pluto": pluto, "raw": raw, "audit": audit,
            "receipt": json.loads(receipt.read_text())}


def demonstrate_cutoff(ctx):
    """Check a small real cohort, including deliberately changed future outcomes."""
    import pandas as pd
    from urban_sentinel.config import CYCLE_START
    from urban_sentinel.featureset import Context, feature_matrix
    cutoff = CYCLE_START[9]
    bins = pd.Index(sorted(ctx.fac.bin.unique())[:25])
    before = feature_matrix(ctx, bins, cutoff, 9)
    past = Context(ctx.fac[(ctx.fac.observed_on < cutoff) & (ctx.fac.cycle < 9)].copy(),
                   {k: v[v.date < cutoff].copy() for k, v in ctx.events.items()})
    # PLUTO's BBL mapping is derived from all façade records in production. Keep it
    # fixed for this temporal test; test only history/event columns, not snapshot attributes.
    history_columns = [c for c in before if c.startswith(("dob_", "ecb_"))]
    from urban_sentinel.features import FACADE_FEATURES
    columns = [c for c in before if c in FACADE_FEATURES or c in history_columns]
    from urban_sentinel.features import build_features
    from urban_sentinel.sources import event_features
    past_features = pd.concat([build_features(past.fac, bins, cutoff, 9),
                               event_features(past.events, bins, cutoff, sources=("dob", "ecb"))], axis=1)
    pd.testing.assert_frame_equal(before[columns], past_features[columns])
    altered = ctx.fac.copy()
    altered.loc[altered.observed_on >= cutoff, "severity"] = 2
    changed = feature_matrix(Context(altered, ctx.events), bins, cutoff, 9)
    pd.testing.assert_frame_equal(before, changed)
    return {"cutoff": str(cutoff.date()), "buildings_checked": len(bins),
            "columns_checked": len(columns), "future_record_invariance": "PASS",
            "future_outcome_invariance": "PASS",
            "caveat": "PLUTO attributes and BIN-to-BBL links are current snapshots, not a full historical reconstruction."}


def rebuild():
    """Evaluate, train and export using only the prepared snapshot."""
    from urban_sentinel import experiments, score, evidence
    from urban_sentinel.config import DATA_DIR, RAW_DIR, OUTPUT_DIR, REPORTS_DIR
    from urban_sentinel.export_frontend import frontend_payload
    prepared = DATA_DIR / "prepared.json"
    if not prepared.exists():
        raise RuntimeError("Run the data preparation cell before training.")
    receipt = json.loads(prepared.read_text())
    if file_hashes(RAW_DIR) != receipt["raw_sha256"]:
        raise RuntimeError("Source files changed after preparation; create a fresh run.")
    started = time.perf_counter()
    print("Evaluating historical cycles (including bootstrap intervals)…", flush=True)
    with warnings.catch_warnings(record=True) as evaluation_warnings:
        metrics = experiments.run()
    # Preserve diagnostics without filling the scrolling presentation with repeated warnings.
    save_json(REPORTS_DIR / "evaluation_warnings.json", [
        {"category": w.category.__name__, "message": str(w.message)} for w in evaluation_warnings
    ])
    if evaluation_warnings:
        print(f"Evaluation emitted {len(evaluation_warnings)} warnings; review reports/evaluation_warnings.json before presenting.")
    save_json(REPORTS_DIR / "metrics.json", metrics)
    (REPORTS_DIR / "RESULTS.md").write_text(experiments.write_markdown(metrics))
    print("Training the deployment model and scoring pending buildings…", flush=True)
    with warnings.catch_warnings(record=True) as training_warnings:
        meta = score.run(refresh=False)
    save_json(REPORTS_DIR / "training_warnings.json", [
        {"category": w.category.__name__, "message": str(w.message)} for w in training_warnings
    ])
    if training_warnings:
        print(f"Training emitted {len(training_warnings)} warnings; review reports/training_warnings.json before presenting.")
    if file_hashes(RAW_DIR) != receipt["raw_sha256"]:
        raise RuntimeError("Pipeline changed the source snapshot; do not present this run.")
    scores = json.loads((OUTPUT_DIR / "buildings_scores.json").read_text())
    validate_result(metrics, scores)
    save_json(OUTPUT_DIR / "presentation_predictions.json", frontend_payload(scores["buildings"], meta))
    manifest = json.loads((DATA_DIR / "presentation_manifest.json").read_text())
    manifest.update(status="complete", completed_at=datetime.now(timezone.utc).isoformat(),
                    elapsed_seconds=round(time.perf_counter() - started, 1),
                    model=meta["model"], platform=evidence.fingerprint(),
                    source_snapshot=receipt, n_scored=meta["n_pending_scored"])
    save_json(DATA_DIR / "presentation_manifest.json", manifest)
    print(f"Complete: {meta['n_pending_scored']:,} buildings scored; model {meta['model']['model_sha256']}.")
    return {"metrics": metrics, "scores": scores, "manifest": manifest}


def validate_result(metrics, scores):
    """Refuse misleading charts if a cohort, cutoff or numerical output is invalid."""
    import math
    from urban_sentinel.config import CYCLE_START
    primary = metrics["primary_cycle9"]
    if primary["test"]["cutoff"] != str(CYCLE_START[9].date()):
        raise ValueError("Unexpected evaluation cutoff; review the timeline before presenting.")
    for block, capacity in [(metrics["dob_cycle9_common_set"], 500),
                             (primary["subgroups"]["previously_safe"], 250)]:
        methods = block["metrics"]
        if len({v["n"] for v in methods.values()}) != 1 or len({v["base_rate"] for v in methods.values()}) != 1:
            raise ValueError("Compared methods have mismatched cohorts.")
        for value in methods.values():
            rate = value[f"precision@{capacity}"]
            if value["n"] < capacity or not math.isfinite(rate) or not 0 <= rate <= 1:
                raise ValueError("Invalid ranking result; do not present this run.")
    reliability = primary["calibration"]["reliability"]
    if sum(r["n"] for r in reliability) != primary["metrics"]["xgboost"]["n"]:
        raise ValueError("Calibration bins do not match the evaluation cohort.")
    for row in reliability:
        if not all(math.isfinite(row[k]) and 0 <= row[k] <= 1 for k in ("mean_predicted", "observed")):
            raise ValueError("Non-finite calibration result; review numerical warnings.")
    pending = [r for r in scores["buildings"] if r.get("prediction")]
    if len(pending) != scores["meta"]["n_pending_scored"]:
        raise ValueError("Pending-building count does not match the scoring metadata.")
    if not all(math.isfinite(r["prediction"]["probability"]) and 0 <= r["prediction"]["probability"] <= 1 for r in pending):
        raise ValueError("Invalid prediction probabilities; do not present this run.")


def choose_building(records):
    pending = sorted((r for r in records if r.get("prediction")), key=lambda r: r["prediction"]["rank"])
    if not pending:
        raise RuntimeError("No pending buildings were scored; choose a supported decision date / dataset.")
    return next((r for r in pending if r["fisp"]["status_on_record"] == "SAFE"), pending[0])


def live_prediction(result, ctx):
    import numpy as np
    import pandas as pd
    from urban_sentinel.artifacts import DeployedModel
    from urban_sentinel.config import DATA_DIR, cycle_at
    from urban_sentinel.featureset import feature_matrix
    from urban_sentinel import evidence
    row = choose_building(result["scores"]["buildings"])
    date = pd.Timestamp(result["scores"]["meta"]["as_of"])
    pending = [r["bin"] for r in result["scores"]["buildings"] if r["prediction"]][:500]
    model = DeployedModel.load()
    check = feature_matrix(ctx.restricted_to(pending), pd.Index(pending), date, cycle_at(date))
    status = model.enable_nnpa(check)
    started = time.perf_counter()
    X = feature_matrix(ctx.restricted_to([row["bin"]]), pd.Index([row["bin"]]), date, cycle_at(date))
    out = model.score_live(X)
    elapsed = (time.perf_counter() - started) * 1000
    # Match the presentation case to the saved model's batch result before displaying.
    raw, calibrated, _ = model.predict(X)
    np.testing.assert_allclose(out["raw"], raw, atol=1e-5, rtol=0)
    np.testing.assert_allclose(out["probability"], calibrated, atol=1e-5, rtol=0)
    from urban_sentinel.score import _describe
    contributions = sorted(zip(model.meta["features"], out["contrib"][0]), key=lambda kv: -abs(kv[1]))[:6]
    factors = pd.DataFrame([{"Factor": _describe(f, X.iloc[0][f])[0],
                             "Value": _describe(f, X.iloc[0][f])[1], "Log-odds contribution": float(c)}
                            for f, c in contributions])
    record = {"bin": row["bin"], "address": row.get("address"), "probability": float(out["probability"][0]),
              "rank": row["prediction"]["rank"], "prior_status": row["fisp"]["status_on_record"],
              "engine": out["engine"], "tree_format": out["tree_format"],
              "model_inference_ms": out["score_ms"], "end_to_end_ms": elapsed,
              "platform": evidence.fingerprint(), "model": model.meta["model_sha256"],
              "nnpa": status, "contributions": factors.to_dict(orient="records")}
    save_json(DATA_DIR / "outputs" / "presentation_live_score.json", record)
    return record, factors


def source_inventory(repo, prepared):
    import pandas as pd
    from urban_sentinel.config import DATASETS
    rows = []
    for key, title, role, count in [
        ("facades", "Façade filings", "Outcome labels + prior inspection history", len(prepared["raw"])),
        ("dob_violations", "DOB violations", "Dated model inputs", len(prepared["context"].events["dob"])),
        ("ecb_violations", "ECB violations", "Dated model inputs", len(prepared["context"].events["ecb"])),
        ("complaints", "DOB complaints", "Evaluated; excluded from deployed features", len(prepared["context"].events["cmp"])),
        ("pluto", "PLUTO", "Building attributes + lot location (current snapshot)", len(prepared["pluto"])),
    ]:
        rows.append({"Source": title, "Records": f"{count:,}", "Role": role,
                     "Reference": f"https://data.cityofnewyork.us/d/{DATASETS[key]}"})
    footprints = json.loads((repo / "frontend/public/data/buildings-demo.geojson").read_text())
    rows += [{"Source": "NYC building footprints", "Records": f"{len(footprints['features']):,} exported geometries",
              "Role": "Map geometry; committed Lower Manhattan export", "Reference": "https://data.cityofnewyork.us/d/5zhs-2jue"},
             {"Source": "NASA OPERA DISP-S1", "Records": "See measured-layer metadata", "Role": "Satellite research + visualization", "Reference": "https://www.jpl.nasa.gov/go/opera/"},
             {"Source": "NYC DOB risk score (2022)", "Records": "Matched evaluation cohort", "Role": "Benchmark only; fetched, never redistributed", "Reference": "https://github.com/NYCDOB/FacadeRisk"}]
    return pd.DataFrame(rows)
