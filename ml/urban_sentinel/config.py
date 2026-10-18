"""Static configuration: dataset ids, FISP cycle calendar, paths."""
from __future__ import annotations

import os
from pathlib import Path

import pandas as pd

ML_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_DIR.parent
# data/ is gitignored at any depth; raw caches and trained models live here, never in git.
DATA_DIR = Path(os.environ.get("URBAN_SENTINEL_DATA_DIR", REPO_ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"
MODEL_DIR = DATA_DIR / "models"
OUTPUT_DIR = DATA_DIR / "outputs"
REPORTS_DIR = Path(os.environ.get("URBAN_SENTINEL_REPORTS_DIR", ML_DIR / "reports"))

SOCRATA_DOMAIN = "data.cityofnewyork.us"
DATASETS = {
    "facades": "xubg-57si",  # DOB NOW: Safety - Facades Compliance Filings
    "dob_violations": "3h2n-5cm9",
    "ecb_violations": "6bgk-3dad",
    "complaints": "eabe-havv",
    "pluto": "64uk-42ks",
    "footprints": "5zhs-2jue",
}
# NYC DOB's published façade risk snapshot (no license declared): fetched at runtime for
# benchmarking only, never redistributed.
DOB_FACADE_RISK_URL = "https://raw.githubusercontent.com/NYCDOB/FacadeRisk/master/FacadeRisk_Unproj.json"
DOB_FACADE_RISK_SNAPSHOT = pd.Timestamp("2022-03-17")  # last commit date of that repo

# FISP (1 RCNY §103-04): five-year cycles starting Feb 21; each sub-cycle has a two-year
# filing window, staggered one year apart and assigned by the last digit of the tax block.
# Anchored on cycle 8 = 2015-02-21 and cycle 10 = 2025-02-21 (rule text + DOB service notice).
CYCLE_START = {c: pd.Timestamp(f"{2015 + 5 * (c - 8)}-02-21") for c in range(5, 12)}
SUBCYCLE_BY_BLOCK_DIGIT = {
    **{d: "A" for d in "4569"},
    **{d: "B" for d in "078"},
    **{d: "C" for d in "123"},
}
SUBCYCLE_OFFSET_YEARS = {"A": 0, "B": 1, "C": 2}  # window opens start + offset, closes 2 years later

STATUS_SEVERITY = {"SAFE": 0, "SWARMP": 1, "UNSAFE": 2}
BOROUGH_CODE = {"Manhattan": 1, "Bronx": 2, "Brooklyn": 3, "Queens": 4, "Staten Island": 5}


def subcycle_for_block(block: str | int | None) -> str | None:
    if block is None or (isinstance(block, float) and pd.isna(block)):
        return None
    digits = "".join(ch for ch in str(block) if ch.isdigit())
    return SUBCYCLE_BY_BLOCK_DIGIT.get(digits[-1]) if digits else None


def subcycle_deadline(cycle: int, subcycle: str) -> pd.Timestamp:
    """Last day of the sub-cycle's two-year filing window."""
    return CYCLE_START[cycle] + pd.DateOffset(years=SUBCYCLE_OFFSET_YEARS[subcycle] + 2)


def cycle_at(date: pd.Timestamp) -> int:
    """FISP cycle in force on a given date."""
    return max(c for c, start in CYCLE_START.items() if start <= date)
