"""Ranking and calibration metrics framed around a fixed proactive-inspection capacity."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

CAPACITIES = (250, 500, 1000)


def precision_recall_at_k(y: np.ndarray, score: np.ndarray, k: int) -> tuple[float, float]:
    k = min(k, len(y))
    # Stable sort with a fixed tie-break so tied scores (e.g. the rule baseline) are deterministic.
    order = np.lexsort((np.arange(len(score)), -score))[:k]
    hits = y[order].sum()
    return float(hits / k), float(hits / max(y.sum(), 1))


def expected_calibration_error(y: np.ndarray, prob: np.ndarray, bins: int = 10) -> float:
    edges = np.quantile(prob, np.linspace(0, 1, bins + 1))
    idx = np.clip(np.searchsorted(edges, prob, side="right") - 1, 0, bins - 1)
    ece = 0.0
    for b in range(bins):
        mask = idx == b
        if mask.any():
            ece += mask.mean() * abs(y[mask].mean() - prob[mask].mean())
    return float(ece)


def ranking_metrics(y, score, capacities=CAPACITIES) -> dict:
    y = np.asarray(y, dtype=int)
    score = np.asarray(score, dtype=float)
    out = {"n": int(len(y)), "positives": int(y.sum()), "base_rate": float(y.mean()),
           "pr_auc": float(average_precision_score(y, score)),
           "roc_auc": float(roc_auc_score(y, score)) if 0 < y.sum() < len(y) else float("nan")}
    for k in capacities:
        if k <= len(y):
            p, r = precision_recall_at_k(y, score, k)
            out[f"precision@{k}"], out[f"recall@{k}"] = p, r
            out[f"lift@{k}"] = p / out["base_rate"] if out["base_rate"] > 0 else float("nan")
    return out


def calibration_metrics(y, prob) -> dict:
    y = np.asarray(y, dtype=int)
    prob = np.asarray(prob, dtype=float)
    return {"brier": float(brier_score_loss(y, prob)), "ece": expected_calibration_error(y, prob),
            "mean_predicted": float(prob.mean()), "observed_rate": float(y.mean())}


def reliability_table(y, prob, bins: int = 10) -> list[dict]:
    frame = pd.DataFrame({"y": np.asarray(y, int), "p": np.asarray(prob, float)})
    frame["bin"] = pd.qcut(frame["p"].rank(method="first"), bins, labels=False)
    table = frame.groupby("bin").agg(mean_predicted=("p", "mean"), observed=("y", "mean"), n=("y", "size"))
    return table.reset_index(drop=True).round(4).to_dict(orient="records")


def paired_bootstrap(y, score_a, score_b, metric: str = "pr_auc", n_boot: int = 1000, seed: int = 0) -> dict:
    """CI for metric(A) - metric(B), resampling buildings jointly so both are scored on the same draws."""
    y = np.asarray(y, int)
    a = np.asarray(score_a, float)
    b = np.asarray(score_b, float)
    rng = np.random.default_rng(seed)

    def value(idx, s):
        if metric == "pr_auc":
            return average_precision_score(y[idx], s[idx])
        k = int(metric.split("@")[1])
        return precision_recall_at_k(y[idx], s[idx], k)[0]

    diffs = np.empty(n_boot)
    for i in range(n_boot):
        idx = rng.integers(0, len(y), len(y))
        diffs[i] = value(idx, a) - value(idx, b)
    full = np.arange(len(y))
    return {"metric": metric, "diff": float(value(full, a) - value(full, b)),
            "ci95": [float(np.quantile(diffs, 0.025)), float(np.quantile(diffs, 0.975))],
            "p_le_zero": float((diffs <= 0).mean())}
