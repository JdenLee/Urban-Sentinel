"""Load and type the raw sources used by the model."""
from __future__ import annotations

import json
import urllib.request

import numpy as np
import pandas as pd

from . import socrata
from .config import (BOROUGH_CODE, DATASETS, DOB_FACADE_RISK_URL, RAW_DIR, STATUS_SEVERITY,
                     subcycle_deadline, subcycle_for_block)

FACADE_COLUMNS = [
    "tr6_no", "control_no", "filing_type", "cycle", "bin", "house_no", "street_name", "borough",
    "block", "lot", "sequence_no", "submitted_on", "filing_date", "filing_status",
    "field_inspection_completed_date", "exterior_wall_type_s_", "exterior_wall_material_s_",
]
# Deliberately NOT loaded (leaky): current_status (present-day snapshot), prior_status (recorded on the
# target filing itself), late/failure penalty amounts and comments (updated after filing).

PLACEHOLDER_BINS = {f"{b}000000" for b in range(1, 6)}


def valid_bin(series: pd.Series) -> pd.Series:
    s = series.astype("string").str.strip()
    return s.str.fullmatch(r"[1-5]\d{6}").fillna(False) & ~s.isin(PLACEHOLDER_BINS)


def load_facades(refresh: bool = False) -> pd.DataFrame:
    raw = socrata.cached_query("facades", DATASETS["facades"], select=",".join(FACADE_COLUMNS), refresh=refresh)
    df = raw.copy()
    df["bin"] = df["bin"].str.strip()
    df = df[valid_bin(df["bin"])].copy()
    df["cycle"] = pd.to_numeric(df["cycle"], errors="coerce").astype("Int64")
    df = df[df["cycle"].notna()].copy()
    df["cycle"] = df["cycle"].astype(int)
    for col in ["submitted_on", "filing_date", "field_inspection_completed_date"]:
        df[col] = pd.to_datetime(df[col], errors="coerce").dt.normalize()
    df["severity"] = df["filing_status"].map(STATUS_SEVERITY)  # NaN for "No Report Filed"
    df["is_nrf"] = df["filing_status"].eq("No Report Filed")
    df["subcycle"] = df["block"].map(subcycle_for_block)
    df["borough_code"] = df["borough"].map(BOROUGH_CODE)
    deadline = [subcycle_deadline(c, s) if s else pd.NaT for c, s in zip(df["cycle"], df["subcycle"])]
    df["subcycle_deadline"] = pd.to_datetime(pd.Series(deadline, index=df.index))
    # When did this record become observable? Conservative: the later of the two filing dates.
    # Auto-generated "No Report Filed" rows carry no date; DOB creates them once the filing window closes,
    # so they are treated as observable at the sub-cycle deadline.
    observed = df[["submitted_on", "filing_date"]].max(axis=1)
    auto = df["filing_type"].eq("Auto-Generated")
    observed = observed.where(~auto | observed.notna(), df["subcycle_deadline"])
    df["observed_on"] = observed
    return df.reset_index(drop=True)


def load_dob_facade_risk(refresh: bool = False) -> pd.Series:
    """DOB's published 2022 façade risk probability per BIN (benchmark only, never redistributed)."""
    path = RAW_DIR / "dob_facade_risk.json"
    if refresh or not path.exists():
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(DOB_FACADE_RISK_URL, timeout=180) as resp:
            path.write_bytes(resp.read())
    features = json.loads(path.read_text())["features"]
    frame = pd.DataFrame([f["properties"] for f in features])
    frame["bin"] = frame["BIN_1"].astype("Int64").astype("string")
    frame = frame[valid_bin(frame["bin"])]
    return frame.groupby("bin")["PredProb"].max().astype(float)


if __name__ == "__main__":
    fac = load_facades()
    print(fac.shape, fac["observed_on"].isna().sum(), "rows without an observable date")
    print(fac.groupby(["cycle", "filing_type"]).size().unstack(fill_value=0))
    print(np.round(load_dob_facade_risk().describe(), 3))
