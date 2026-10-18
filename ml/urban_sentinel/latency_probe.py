"""Measure live /score latency and NNPA-vs-XGBoost parity through the running API (run on the VM).

Run from ml/ inside the container while the API is up:
  python -m urban_sentinel.latency_probe --n 200
Writes reports/latency_<machine>.json.
"""
from __future__ import annotations

import argparse
import json
import platform
import random
import statistics
import urllib.error
import urllib.request

from .config import REPORTS_DIR


def call(base: str, path: str, method: str = "GET") -> dict:
    req = urllib.request.Request(base + path, method=method)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def summarise(values: list[float]) -> dict:
    values = sorted(values)
    return {"n": len(values), "median": round(statistics.median(values), 4), "mean": round(statistics.fmean(values), 4),
            "p95": round(values[int(0.95 * (len(values) - 1))], 4), "min": round(values[0], 4), "max": round(values[-1], 4)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--n", type=int, default=200)
    args = ap.parse_args()
    health = call(args.base, "/health")
    pending = [b["bin"] for b in call(args.base, "/top?k=2000")["buildings"]]
    bins = random.Random(0).sample(pending, min(args.n, len(pending)))
    engines = ["nnpa", "xgboost"] if health["inference_engine"]["engine"] == "snapml-nnpa" else ["xgboost"]
    results = {e: {"model_ms": [], "total_ms": [], "prob": {}} for e in engines}
    for b in bins:
        for e in engines:  # same building, both engines, back to back
            r = call(args.base, f"/score/{b}?engine={e}", "POST")
            results[e]["model_ms"].append(r["model_inference_ms"])
            results[e]["total_ms"].append(r["total_ms_incl_features"])
            results[e]["prob"][b] = r["probability"]
    report = {"health": health, "buildings": len(bins),
              "engines": {e: {"model_inference_ms": summarise(v["model_ms"]),
                              "end_to_end_ms_incl_feature_build": summarise(v["total_ms"])} for e, v in results.items()}}
    if len(engines) == 2:
        diffs = [abs(results["nnpa"]["prob"][b] - results["xgboost"]["prob"][b]) for b in bins]
        report["parity_nnpa_vs_xgboost"] = {"max_abs_diff_probability": max(diffs),
                                            "identical_to_4dp": sum(d == 0 for d in diffs) / len(diffs)}
    path = REPORTS_DIR / f"latency_{platform.machine()}.json"
    path.write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != "health"}, indent=2))
    print("written", path)


if __name__ == "__main__":
    main()
