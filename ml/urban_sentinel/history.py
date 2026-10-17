"""Per-building history for the frontend: FISP filings, DOB/ECB/311 façade events, and InSAR ground movement.

Everything here is recorded history, not model output. The movement series is visual context only: the InSAR
ablation found no predictive gain, so it is not a model input (reports/INSAR_ABLATION.md).

Endpoint (mounted by serve.py):  GET /buildings/{bin}/history
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException

from .config import DATA_DIR, RAW_DIR
from .ingest import PLACEHOLDER_BINS

MOVEMENT_FILE = DATA_DIR / "insar" / "movement_series.npz"
MOVEMENT_META_FILE = DATA_DIR / "insar" / "movement_series.json"

# Readable labels for the code groups in sources.py (DOB_CODES / ECB_CODES / COMPLAINT_CODES).
EVENT_TYPES = {"dob": "DOB violation", "ecb": "ECB violation", "cmp": "311 complaint"}
EVENT_LABELS = {
    ("dob", "facade"): "Façade (Local Law 11 / FISP)",
    ("dob", "fisp_compliance"): "FISP compliance (report not filed or unsafe condition not corrected)",
    ("dob", "structural"): "Unsafe or compromised building",
    ("ecb", "wall"): "Failure to maintain exterior wall",
    ("ecb", "report"): "Required façade report not filed",
    ("ecb", "unsafe_measures"): "No public-safety measures for an unsafe façade",
    ("ecb", "shed"): "Sidewalk shed or pedestrian protection",
    ("cmp", "debris"): "Debris falling or in danger of falling",
    ("cmp", "wall_bulging"): "Wall bulging or cracked",
    ("cmp", "structural"): "Structural stability",
    ("cmp", "shed"): "Sidewalk shed",
    ("cmp", "maintenance"): "Failure to maintain",
    ("cmp", "suspended_scaffold"): "Suspended scaffold",
    ("cmp", "sign"): "Sign",
    ("cmp", "unsafe_notification"): "Unsafe façade notification",
}
SOURCE_FILES = [  # raw/<name>.meta.json written by socrata.cached_query
    ("facades", "FISP filings"),
    ("dob_violations_facade", "DOB violations"),
    ("ecb_violations_facade", "ECB violations"),
    ("complaints_facade", "311 complaints"),
]
_BIN_RE = re.compile(r"[1-5]\d{6}")


def valid_bin(bin_id: str) -> bool:
    return bool(_BIN_RE.fullmatch(bin_id)) and bin_id not in PLACEHOLDER_BINS


def _iso(v) -> str | None:
    if v is None or pd.isna(v):
        return None
    return pd.Timestamp(v).date().isoformat()


def _text(v) -> str | None:
    if v is None or pd.isna(v):
        return None
    s = str(v).strip()
    return s or None


@dataclass
class MovementStore:
    """Per-BIN InSAR series written by ml/insar/export_series.py."""
    index: dict[str, int]
    dates: list[str]
    disp: np.ndarray        # (n_bins, T) LOS mm, building pixels, relative to the NYC-window median
    base: np.ndarray        # (n_bins, T) LOS mm, ~2 km neighbourhood background at the building
    vel_hp: np.ndarray      # (n_bins,) mm/yr, building minus neighbourhood, full period
    meta: dict

    @classmethod
    def load(cls, npz: Path = MOVEMENT_FILE, meta: Path = MOVEMENT_META_FILE) -> "MovementStore | None":
        if not npz.exists():
            return None
        with np.load(npz, allow_pickle=False) as z:
            bins = [str(b) for b in z["bins"]]
            store = cls({b: i for i, b in enumerate(bins)}, [str(d) for d in z["dates"]],
                        z["disp"], z["base"], z["vel_hp"], {})
        store.meta = json.loads(meta.read_text()) if meta.exists() else {}
        return store

    def series(self, bin_id: str) -> dict | None:
        i = self.index.get(bin_id)
        if i is None:
            return None
        pts = [{"date": d, "displacement_mm": round(float(v), 2),
                "baseline_mm": None if not np.isfinite(b) else round(float(b), 2)}
               for d, v, b in zip(self.dates, self.disp[i], self.base[i]) if np.isfinite(v)]
        if len(pts) < 2:
            return None
        vel = float(self.vel_hp[i])
        return {"meta": self.meta, "series": pts,
                "velocity_hp2km_mm_yr": round(vel, 2) if np.isfinite(vel) else None}


def fisp_records(fac: pd.DataFrame) -> list[dict]:
    out = []
    for r in fac.itertuples(index=False):
        date = r.filing_date if pd.notna(r.filing_date) else r.submitted_on
        if pd.isna(date) and getattr(r, "filing_type", None) == "Auto-Generated":
            date = getattr(r, "subcycle_deadline", pd.NaT)
        status = _text(r.filing_status) or "status not recorded"
        parts = [f"Cycle {r.cycle} {(_text(r.filing_type) or 'filing').lower()}: {status}"]
        inspected = _iso(getattr(r, "field_inspection_completed_date", None))
        if inspected:
            parts.append(f"inspected {inspected}")
        wall = " / ".join(w for w in (_text(getattr(r, "exterior_wall_type_s_", None)),
                                      _text(getattr(r, "exterior_wall_material_s_", None))) if w)
        if wall:
            parts.append(f"walls: {wall.lower()}")
        out.append({"date": _iso(date), "type": "FISP filing", "description": " · ".join(parts),
                    "status": _text(r.filing_status), "cycle": int(r.cycle), "reference": _text(r.tr6_no)})
    return out


def event_records(events: dict[str, pd.DataFrame]) -> list[dict]:
    out = []
    for src, df in events.items():
        for r in df.itertuples(index=False):
            out.append({"date": _iso(r.date), "type": EVENT_TYPES.get(src, src),
                        "description": EVENT_LABELS.get((src, r.group), str(r.group).replace("_", " "))})
    return out


def source_refs(raw_dir: Path = RAW_DIR) -> list[dict]:
    refs = []
    for name, label in SOURCE_FILES:
        p = raw_dir / f"{name}.meta.json"
        if p.exists():
            m = json.loads(p.read_text())
            refs.append({"name": f"{label} ({m.get('dataset_id', '?')})",
                         "observed_at": (m.get("rows_updated_at") or m.get("fetched_at") or "")[:10] or None})
    return refs


def build_history(bin_id: str, fac: pd.DataFrame, events: dict[str, pd.DataFrame], buildings: dict,
                  movement: MovementStore | None, raw_dir: Path = RAW_DIR) -> dict:
    """Everything on record for one building, newest first. Pure: callers pass the already-loaded data."""
    rec = buildings.get(bin_id)
    fac_b = fac[fac["bin"] == bin_id]
    ev_b = {k: v[v["bin"] == bin_id] for k, v in events.items()}
    records = fisp_records(fac_b) + event_records(ev_b)
    records.sort(key=lambda r: r["date"] or "", reverse=True)
    if rec is not None:
        address, borough, lat, lon = rec.get("address"), rec.get("borough"), rec.get("lat"), rec.get("lon")
    elif len(fac_b):
        first = fac_b.iloc[0]
        address = " ".join(s for s in (_text(first.get("house_no")), _text(first.get("street_name"))) if s) or None
        borough, lat, lon = _text(first.get("borough")), None, None
    else:
        address = borough = lat = lon = None
    counts = {}
    for r in records:
        counts[r["type"]] = counts.get(r["type"], 0) + 1
    return {
        "bin": bin_id,
        "in_fisp_universe": rec is not None or len(fac_b) > 0,
        "address": address, "borough": borough, "lat": lat, "lon": lon,
        "record": rec,
        "records": records,
        "record_counts": counts,
        "movement": movement.series(bin_id) if movement is not None else None,
        "sources": source_refs(raw_dir),
    }


def build_router(get_state: Callable[[], object]) -> APIRouter:
    """`get_state()` returns serve.State (buildings dict + Context); the movement store is loaded lazily, once."""
    router = APIRouter()
    cache: dict[str, MovementStore | None] = {}

    def movement() -> MovementStore | None:
        mtime = MOVEMENT_FILE.stat().st_mtime if MOVEMENT_FILE.exists() else None
        key = str(mtime)
        if key not in cache:
            cache.clear()
            cache[key] = MovementStore.load()
        return cache[key]

    @router.get("/buildings/{bin_id}/history")
    def history(bin_id: str):
        bin_id = bin_id.strip()
        if not valid_bin(bin_id):
            raise HTTPException(422, f"{bin_id!r} is not a valid NYC BIN (7 digits, borough 1-5, not a placeholder)")
        state = get_state()
        return build_history(bin_id, state.ctx.fac, state.ctx.events, state.buildings, movement())

    return router
