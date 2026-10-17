"""Small FastAPI service exposing building scores and live on-server inference.

Run from ml/:  uvicorn urban_sentinel.serve:app --host 127.0.0.1 --port 8000
On LinuxONE bind to 127.0.0.1 and reach it through an SSH tunnel (see deploy/linuxone/RUNBOOK.md).
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Literal

import pandas as pd
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import evidence, score
from .artifacts import DeployedModel
from .config import OUTPUT_DIR, REPORTS_DIR, cycle_at
from .featureset import Context, feature_matrix

SCORES_FILE = OUTPUT_DIR / "buildings_scores.json"
DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"


class State:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.rescoring = False
        self.load()

    def load(self) -> None:
        if not SCORES_FILE.exists():
            raise RuntimeError(f"{SCORES_FILE} missing: run `python -m urban_sentinel.score` first")
        payload = json.loads(SCORES_FILE.read_text())
        model = DeployedModel.load()
        ctx = Context.load()
        # Parity check for the NNPA engine on up to 500 pending buildings (XGBoost stays the engine on any failure).
        sample = [r["bin"] for r in payload["buildings"] if r["prediction"]][:500]
        now = pd.Timestamp.now().normalize()
        model.enable_nnpa(feature_matrix(ctx.restricted_to(sample), pd.Index(sample), now, cycle_at(now)))
        with self.lock:
            self.meta = payload["meta"]
            self.buildings = {r["bin"]: r for r in payload["buildings"]}
            self.model = model
            self.ctx = ctx


state = State()
app = FastAPI(title="Urban Sentinel façade model", version=state.model.meta["model_sha256"])
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("URBAN_SENTINEL_CORS", DEFAULT_ORIGINS).split(","),
                   allow_methods=["GET", "POST"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"status": "ok", "platform": evidence.fingerprint(), "model": state.model.meta["model_sha256"],
            "scores_generated_at": state.meta["generated_at"], "data_as_of": state.meta["as_of"],
            "n_buildings": len(state.buildings), "rescoring": state.rescoring,
            "inference_engine": state.model.nnpa_status}


@app.get("/meta")
def meta():
    return state.meta


@app.get("/metrics")
def metrics():
    path = REPORTS_DIR / "metrics.json"
    evaluation = json.loads(path.read_text()) if path.exists() else None
    return {"backtest_same_vantage": state.meta["backtest_same_vantage"], "evaluation": evaluation}


@app.get("/buildings/{bin_id}")
def building(bin_id: str):
    rec = state.buildings.get(bin_id)
    if rec is None:
        raise HTTPException(404, f"BIN {bin_id} is not in the FISP universe")
    return rec


@app.get("/top")
def top(k: int = Query(50, ge=1, le=2000), mode: Literal["all", "unknown_risk"] = "all",
        borough: str | None = None):
    """Highest-priority pending buildings. `unknown_risk` drops buildings already on record as UNSAFE,
    surfacing façades not currently known to be a problem."""
    rows = [r for r in state.buildings.values() if r["prediction"]]
    if mode == "unknown_risk":
        rows = [r for r in rows if r["fisp"]["status_on_record"] != "UNSAFE"]
    if borough:
        rows = [r for r in rows if (r["borough"] or "").lower() == borough.lower()]
    rows.sort(key=lambda r: r["prediction"]["rank"])
    return {"mode": mode, "k": k, "buildings": rows[:k]}


@app.get("/buildings.geojson")
def geojson(tier: str | None = None, bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat")):
    box = [float(v) for v in bbox.split(",")] if bbox else None
    if box and len(box) != 4:
        raise HTTPException(422, "bbox must be minLon,minLat,maxLon,maxLat")
    features = []
    for r in state.buildings.values():
        if r["lat"] is None:
            continue
        if box and not (box[0] <= r["lon"] <= box[2] and box[1] <= r["lat"] <= box[3]):
            continue
        p = r["prediction"]
        if tier and (p is None or p["tier"] != tier):
            continue
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
                         "properties": {"bin": r["bin"], "address": r["address"],
                                        "status_on_record": r["fisp"]["status_on_record"],
                                        "current_cycle_status": r["fisp"]["current_cycle_status"],
                                        "probability": p["probability"] if p else None,
                                        "tier": p["tier"] if p else None, "rank": p["rank"] if p else None}})
    return {"type": "FeatureCollection", "features": features}


@app.post("/score/{bin_id}")
def live_score(bin_id: str):
    """Recompute this building's features from current records and run the model now, on this server."""
    rec = state.buildings.get(bin_id)
    if rec is None:
        raise HTTPException(404, f"BIN {bin_id} is not in the FISP universe")
    now = pd.Timestamp.now().normalize()
    t0 = time.perf_counter()
    features = state.model.meta["features"]
    sub = state.ctx.restricted_to([bin_id])  # every feature is per-building
    X = feature_matrix(sub, pd.Index([bin_id]), now, cycle_at(now))[features]
    out = state.model.score_live(X)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    fp = evidence.fingerprint()
    return {"bin": bin_id, "probability": round(float(out["probability"][0]), 4),
            "raw_score": round(float(out["raw"][0]), 4),
            "already_filed_this_cycle": rec["fisp"]["current_cycle_filed"],
            "engine": out["engine"], "tree_format": out["tree_format"],
            "model_inference_ms": round(out["score_ms"], 4), "total_ms_incl_features": round(elapsed_ms, 2),
            "features": {k: (None if pd.isna(v) else v) for k, v in zip(features, X.iloc[0].tolist())},
            "contributions": dict(zip(features, [round(float(c), 4) for c in out["contrib"][0]])),
            "explanations": "XGBoost TreeSHAP (CPU)", "machine": fp["machine"], "byteorder": fp["byteorder"],
            "model": state.model.meta["model_sha256"]}


def _rescore() -> None:
    try:
        score.run(refresh=True)
        state.load()
    finally:
        state.rescoring = False


@app.post("/rescore", status_code=202)
def rescore(background: BackgroundTasks, x_admin_token: str | None = Header(None)):
    """Pull the latest façade filings from NYC Open Data, retrain at today's vantage and rescore (async)."""
    expected = os.environ.get("URBAN_SENTINEL_ADMIN_TOKEN")
    if not expected or x_admin_token != expected:
        raise HTTPException(401, "admin token required")
    if state.rescoring:
        return {"status": "already running"}
    state.rescoring = True
    background.add_task(_rescore)
    return {"status": "started"}
