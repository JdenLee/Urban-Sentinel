"""One command for the full run: ingest → evaluate → train (today's vantage) → score → manifest.

Run from ml/:  python -m urban_sentinel.pipeline [--refresh] [--skip-eval]
"""
from __future__ import annotations

import argparse
import json
import time

from . import evidence, experiments, score
from .config import OUTPUT_DIR, REPORTS_DIR


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download NYC Open Data before running")
    ap.add_argument("--skip-eval", action="store_true", help="skip the historical evaluation (faster rescoring)")
    args = ap.parse_args()
    t0 = time.time()
    manifest = {"platform": evidence.fingerprint(), "steps": {}}
    if not args.skip_eval:
        t = time.time()
        report = experiments.run()
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        (REPORTS_DIR / "metrics.json").write_text(json.dumps(report, indent=2, default=str))
        (REPORTS_DIR / "RESULTS.md").write_text(experiments.write_markdown(report))
        manifest["steps"]["evaluate"] = {"seconds": round(time.time() - t, 1),
                                         "cycle9_xgboost_pr_auc": report["primary_cycle9"]["metrics"]["xgboost"]["pr_auc"]}
    t = time.time()
    meta = score.run(refresh=args.refresh)
    manifest["steps"]["train_and_score"] = {"seconds": round(time.time() - t, 1), **meta["run"],
                                            "n_scored": meta["n_pending_scored"], "model": meta["model"],
                                            "backtest_pr_auc": meta["backtest_same_vantage"]["xgboost"]["pr_auc"]}
    manifest["total_seconds"] = round(time.time() - t0, 1)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "run_manifest.json").write_text(json.dumps(manifest, indent=2, default=str))
    (REPORTS_DIR / f"run_manifest_{manifest['platform']['machine']}.json").write_text(
        json.dumps(manifest, indent=2, default=str))
    print(json.dumps(manifest, indent=2, default=str))


if __name__ == "__main__":
    main()
