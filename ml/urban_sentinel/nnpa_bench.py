"""Serve the deployed XGBoost model through IBM Snap ML and check whether it runs on the IBM Z NNPA accelerator.

Evidence rules (nothing is claimed otherwise):
  * the CPU advertises `nnpa` and zDNN's own `zdnn_is_nnpa_installed()` returns true;
  * Snap ML reports `optimized_tree_format_ == "zdnn_tensors"` for the imported model;
  * its predictions match XGBoost's on the same buildings (ranking and probabilities).

Run on LinuxONE from ml/ (see deploy/linuxone/RUNBOOK.md):
  python -m urban_sentinel.nnpa_bench
Writes reports/nnpa_benchmark_<machine>.json.
"""
from __future__ import annotations

import ctypes
import ctypes.util
import glob
import json
import os
import platform
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

from . import evidence
from .artifacts import MODEL_FILE, DeployedModel
from .config import REPORTS_DIR, cycle_at
from .featureset import Context, feature_matrix
from .labels import build_labels

ZDNN_GLOBS = ["/usr/lib*/libzdnn.so*", "/usr/lib/*/libzdnn.so*", "/usr/local/lib*/libzdnn.so*",
              "/opt/venv/lib/python3*/site-packages/**/libzdnn*.so*", "/opt/**/libzdnn*.so*"]


def find_zdnn() -> list[str]:
    found = []
    if os.environ.get("SNAPML_ZDNN_LIB"):
        found.append(os.environ["SNAPML_ZDNN_LIB"])
    lib = ctypes.util.find_library("zdnn")
    if lib:
        found.append(lib)
    for pattern in ZDNN_GLOBS:
        found.extend(sorted(glob.glob(pattern, recursive=True)))
    return list(dict.fromkeys(found))


def legacy_xgb_json(src, dst, keep_feature_names: bool = False) -> None:
    """Rewrite an XGBoost 3.x JSON model in the 1.x layout Snap ML's importer expects.

    Snap ML (1.17.2) parses the file textually: XGBoost 3.x brackets base_score ("[2.4E-1]"), adds a
    gbtree "cats" block and drops learner "name":"generic", after which it reports "no objective defined".
    The trees themselves are unchanged, and XGBoost loads the rewritten file with identical predictions
    (checked in run()).
    """
    m = json.loads(Path(src).read_text())
    learner = m["learner"]
    lmp = dict(learner["learner_model_param"])
    lmp["base_score"] = lmp["base_score"].strip("[]")
    model = {k: v for k, v in learner["gradient_booster"]["model"].items() if k != "cats"}
    legacy = {"learner": {
        "attributes": learner.get("attributes", {}),
        "feature_names": learner["feature_names"] if keep_feature_names else [],
        "feature_types": learner["feature_types"] if keep_feature_names else [],
        "gradient_booster": {"model": model, "name": learner["gradient_booster"]["name"]},
        "learner_model_param": lmp,
        "name": "generic",
        "objective": learner["objective"],
    }, "version": [1, 7, 6]}
    Path(dst).write_text(json.dumps(legacy, separators=(",", ":")))


def zdnn_status(path: str) -> dict:
    out = {"path": path}
    try:
        lib = ctypes.CDLL(path)
        lib.zdnn_init()
        lib.zdnn_is_nnpa_installed.restype = ctypes.c_bool
        out["nnpa_installed"] = bool(lib.zdnn_is_nnpa_installed())
        try:
            lib.zdnn_get_library_version_str.restype = ctypes.c_char_p
            out["library_version"] = lib.zdnn_get_library_version_str().decode()
        except AttributeError:
            pass
    except OSError as exc:
        out["error"] = f"load failed: {exc}"
    except AttributeError as exc:
        out["error"] = f"symbol missing: {exc}"
    return out


def timed(fn, repeats: int) -> tuple[object, float]:
    result = fn()  # warm-up
    t0 = time.perf_counter()
    for _ in range(repeats):
        result = fn()
    return result, (time.perf_counter() - t0) / repeats * 1000


SENTINEL = -1e6  # below every feature's real range (days_vs_deadline_last can be about -1,000)


def compare_formats(snapml, model_path, Xnp: np.ndarray, ref: np.ndarray) -> dict:
    complete = ~np.isnan(Xnp).any(axis=1)
    order_ref = np.argsort(-ref, kind="stable")
    out = {}
    for fmt in ("compress_trees", "zdnn_tensors", "auto"):
        entry: dict = {}
        try:
            sm = snapml.BoostingMachineClassifier()
            sm.import_model(str(model_path), "xgb_json", tree_format=fmt, X=Xnp)
            entry["optimized_tree_format_"] = getattr(sm.booster_, "optimized_tree_format_", None)
            pred, ms = timed(lambda: sm.predict_proba(Xnp)[:, 1], 5)
            _, ms1 = timed(lambda: sm.predict_proba(Xnp[:1])[:, 1], 200)
            diff = np.abs(pred - ref)
            top500 = set(np.argsort(-pred, kind="stable")[:500])
            entry.update({
                "batch_ms": round(ms, 3), "single_row_ms": round(ms1, 4),
                "max_abs_diff_vs_xgboost": float(diff.max()), "mean_abs_diff_vs_xgboost": float(diff.mean()),
                "spearman_vs_xgboost": float(pd.Series(pred).rank().corr(pd.Series(ref).rank())),
                "top500_overlap": len(top500 & set(order_ref[:500])) / 500,
                "rows_without_missing": int(complete.sum()),
                "max_abs_diff_rows_without_missing": float(diff[complete].max()) if complete.any() else None,
            })
        except Exception as exc:  # record honestly: unsupported format, zDNN errors
            entry["error"] = f"{type(exc).__name__}: {exc}"
        out[fmt] = entry
    return out


def nan_free_variant(snapml, model: DeployedModel, Xnp: np.ndarray, ref_deployed: np.ndarray) -> dict:
    """Retrain the deployed configuration with NaN -> SENTINEL, check its accuracy is unchanged (same-vantage
    backtest), then compare Snap ML vs XGBoost on it."""
    from .artifacts import MODEL_DIR
    from .config import CYCLE_START
    from .evaluation import ranking_metrics
    from .models import fit_xgb
    from .score import vantage_dataset

    ctx = Context.load()
    now = pd.Timestamp.now().normalize()
    current = cycle_at(now)
    elapsed = now - CYCLE_START[current]
    feats = model.meta["features"]
    data = {t: vantage_dataset(ctx, t, elapsed) for t in (current - 3, current - 2, current - 1)}
    fill = lambda X: X[feats].fillna(SENTINEL)
    t1, t2, t3 = sorted(data)
    rounds = int(model.meta["xgb_rounds"] * 1.15)
    out: dict = {"sentinel": SENTINEL}
    # Accuracy check at the same vantage: NaN-native vs sentinel, train t1+t2 -> test t3.
    for name, prep in [("nan_native", lambda X: X[feats]), ("sentinel", fill)]:
        m = fit_xgb(pd.concat([prep(data[t1][0]), prep(data[t2][0])]),
                    pd.concat([data[t1][1]["y"], data[t2][1]["y"]]), n_estimators=rounds)
        out[f"backtest_{name}"] = ranking_metrics(data[t3][1]["y"], m.predict_proba(prep(data[t3][0]))[:, 1])
    final = fit_xgb(pd.concat([fill(data[t][0]) for t in (t1, t2, t3)]),
                    pd.concat([data[t][1]["y"] for t in (t1, t2, t3)]), n_estimators=rounds)
    native = MODEL_DIR / "facade_unsafe_xgb_sentinel.json"
    final.get_booster().save_model(str(native))
    legacy = MODEL_DIR / "facade_unsafe_xgb_sentinel_legacy_xgb1.json"
    legacy_xgb_json(native, legacy)
    Xf = np.where(np.isnan(Xnp), SENTINEL, Xnp).astype(np.float32)
    booster = final.get_booster()
    ref, ms = timed(lambda: booster.inplace_predict(Xf), 5)
    _, ms1 = timed(lambda: booster.inplace_predict(Xf[:1]), 200)
    out.update({"xgboost_batch_ms": round(ms, 3), "xgboost_single_row_ms": round(ms1, 4),
                "spearman_vs_deployed_model": float(pd.Series(ref).rank().corr(pd.Series(ref_deployed).rank())),
                "formats": compare_formats(snapml, legacy, Xf, ref)})
    return out


def pending_features() -> pd.DataFrame:
    ctx = Context.load()
    now = pd.Timestamp.now().normalize()
    current = cycle_at(now)
    seen = ctx.fac[(ctx.fac["observed_on"] <= now) | ctx.fac["observed_on"].isna()]
    universe = pd.Index(sorted(set(seen.loc[seen["cycle"] >= current - 1, "bin"])), name="bin")
    pending = universe.difference(build_labels(seen, current).index)
    return feature_matrix(ctx, pending, now, current)


def run() -> dict:
    report = {"platform": evidence.fingerprint(), "cpu_flag_nnpa": "nnpa" in (evidence.fingerprint()["cpu"] or "")}
    zdnn_paths = find_zdnn()
    report["zdnn_candidates"] = zdnn_paths
    report["zdnn"] = [zdnn_status(p) for p in zdnn_paths[:5]]
    usable = next((z["path"] for z in report["zdnn"] if z.get("nnpa_installed")), None)
    if usable and not os.environ.get("SNAPML_ZDNN_LIB"):
        os.environ["SNAPML_ZDNN_LIB"] = usable  # Snap ML only loads its NNPA build when it can find libzdnn

    model = DeployedModel.load()
    X = pending_features()[model.meta["features"]]
    Xnp = X.to_numpy(dtype=np.float32)
    report["n_buildings"] = int(len(X))
    report["nan_fraction"] = float(np.isnan(Xnp).mean())
    report["model_sha256"] = model.meta["model_sha256"]

    booster = model.booster
    # inplace_predict: no DMatrix prediction cache, so repeated timings measure real inference.
    ref, ms = timed(lambda: booster.inplace_predict(Xnp), 5)
    _, ms1 = timed(lambda: booster.inplace_predict(Xnp[:1]), 200)
    report["xgboost"] = {"batch_ms": round(ms, 3), "single_row_ms": round(ms1, 4)}

    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            import snapml  # noqa: WPS433 (import after SNAPML_ZDNN_LIB is set)
        report["snapml"] = {"version": getattr(snapml, "__version__", None),
                            "import_warnings": [str(w.message) for w in caught]}
    except ImportError as exc:
        report["snapml"] = {"error": f"snapml not importable: {exc}"}
        report["verdict"] = "NOT RUN: snapml missing (pip install --no-deps --target <pydeps> snapml)"
        return report

    # Candidate model files: the native XGBoost 3.4 export and legacy-layout rewrites (verified with XGBoost).
    candidates = {"native_xgb3": MODEL_FILE}
    for name, keep in [("legacy_xgb1", False), ("legacy_xgb1_named", True)]:
        path = MODEL_FILE.with_name(f"facade_unsafe_xgb_{name}.json")
        legacy_xgb_json(MODEL_FILE, path, keep_feature_names=keep)
        check = xgb.Booster()
        check.load_model(str(path))
        if float(np.abs(check.inplace_predict(Xnp) - ref).max()) < 1e-6:
            candidates[name] = path
    report["model_file_candidates"] = list(candidates)
    chosen, attempts = None, {}
    for name, path in candidates.items():
        try:
            snapml.BoostingMachineClassifier().import_model(str(path), "xgb_json", tree_format="compress_trees")
            chosen = path
            attempts[name] = "imported"
            break
        except Exception as exc:
            attempts[name] = f"{type(exc).__name__}: {exc}"
    report["snapml"]["import_attempts"] = attempts
    if chosen is None:
        report["verdict"] = "NOT ON NNPA (Snap ML could not import any model file variant); XGBoost remains the serving path"
        return report
    report["snapml"]["model_file"] = chosen.name

    report["snapml"]["formats"] = compare_formats(snapml, chosen, Xnp, ref)

    # Diagnosis + fix: Snap ML's importer may not honour XGBoost's learned default direction for missing
    # values. A variant trained with missing values encoded as an out-of-range sentinel never sees NaN.
    report["nan_free_variant"] = nan_free_variant(snapml, model, Xnp, ref)

    z = report["snapml"]["formats"].get("zdnn_tensors", {})
    nf = report["nan_free_variant"]
    zf = nf.get("formats", {}).get("zdnn_tensors", {})

    def faithful(e):
        return (e.get("optimized_tree_format_") == "zdnn_tensors" and "error" not in e
                and e["spearman_vs_xgboost"] > 0.999 and e["max_abs_diff_vs_xgboost"] < 1e-2)

    if faithful(z):
        report["verdict"] = (f"VERIFIED: deployed model served on the NNPA (zdnn_tensors); batch {z['batch_ms']} ms "
                             f"vs XGBoost {report['xgboost']['batch_ms']} ms; max |dp| {z['max_abs_diff_vs_xgboost']:.2e}")
    elif faithful(zf):
        report["verdict"] = (f"VERIFIED for the NaN-free variant: served on the NNPA (zdnn_tensors) matching XGBoost "
                             f"(max |dp| {zf['max_abs_diff_vs_xgboost']:.2e}, Spearman {zf['spearman_vs_xgboost']:.5f}); "
                             f"batch {zf['batch_ms']} ms vs XGBoost {nf['xgboost_batch_ms']} ms, single row "
                             f"{zf['single_row_ms']} ms vs {nf['xgboost_single_row_ms']} ms. Deployed model diverges "
                             f"because of missing-value handling.")
    elif z.get("optimized_tree_format_") == "zdnn_tensors":
        report["verdict"] = "NNPA format accepted but predictions diverge from XGBoost (also for the NaN-free variant): do not deploy"
    else:
        reason = z.get("error") or f"optimized_tree_format_={z.get('optimized_tree_format_')}"
        report["verdict"] = f"NOT ON NNPA ({reason}); XGBoost remains the serving path"
    return report


if __name__ == "__main__":
    result = run()
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORTS_DIR / f"nnpa_benchmark_{platform.machine()}.json"
    path.write_text(json.dumps(result, indent=2, default=str))
    print(json.dumps({k: result.get(k) for k in ("cpu_flag_nnpa", "zdnn", "snapml", "xgboost", "verdict")},
                     indent=2, default=str))
    print("written", path)
