"""Point-in-time feature construction.

Every feature for a (building, cutoff) pair is computed only from records observable strictly before the
cutoff and from cycles strictly before the target cycle. `build_features` enforces this with a hard check,
so the same function serves training (historical cutoffs) and live scoring (cutoff = today).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

WALL_TOKENS = {
    "terra_cotta": "TERRA COTTA", "brick": "BRICK", "stone": "STONE", "concrete": "CONCRETE",
    "steel": "STEEL", "curtain": "CURTAIN", "cavity": "CAVITY", "load_bearing": "LOAD-BEARING",
    "metal": "METAL", "glass": "GLASS", "stucco": "STUCCO", "eifs": "EIFS", "precast": "PRECAST",
}

FACADE_FEATURES = [
    "has_history", "last_status", "prev_status", "cycles_since_last", "n_cycles_filed", "n_unsafe",
    "n_swarmp", "n_safe", "frac_unsafe", "unsafe_streak", "n_nrf_cycles", "nrf_prev_cycle",
    "days_vs_deadline_last", "n_amended_last", "n_subsequent_last", "status_at_cutoff",
    "repaired_since_last", "years_since_last_filing", "n_initial_last_cycle", "borough_code",
    "subcycle_code", *[f"wall_{k}" for k in WALL_TOKENS],
]


class LeakageError(AssertionError):
    pass


def history_before(fac: pd.DataFrame, cutoff: pd.Timestamp, target_cycle: int) -> pd.DataFrame:
    hist = fac[(fac["observed_on"] < cutoff) & (fac["cycle"] < target_cycle)]
    assert_point_in_time(hist, cutoff, target_cycle)
    return hist


def assert_point_in_time(hist: pd.DataFrame, cutoff: pd.Timestamp, target_cycle: int) -> None:
    if len(hist) == 0:
        return
    if not (hist["observed_on"].max() < cutoff):
        raise LeakageError(f"record observed on {hist['observed_on'].max()} >= cutoff {cutoff}")
    if not (hist["cycle"].max() < target_cycle):
        raise LeakageError(f"cycle {hist['cycle'].max()} >= target cycle {target_cycle}")


def _unsafe_streak(sev: pd.Series) -> int:
    streak = 0
    for value in reversed(sev.to_list()):
        if value != 2:
            break
        streak += 1
    return streak


def build_features(fac: pd.DataFrame, bins: pd.Index, cutoff: pd.Timestamp, target_cycle: int) -> pd.DataFrame:
    cutoff = pd.Timestamp(cutoff)
    hist = history_before(fac, cutoff, target_cycle)
    X = pd.DataFrame(index=pd.Index(bins, name="bin"))

    ini = hist[hist["filing_type"].eq("Initial") & hist["severity"].notna()]
    per_cycle = (ini.groupby(["bin", "cycle"])
                 .agg(sev=("severity", "max"), first_obs=("observed_on", "min"),
                      deadline=("subcycle_deadline", "first"), n_initial=("severity", "size"))
                 .reset_index().sort_values(["bin", "cycle"]))
    rank_from_end = per_cycle.groupby("bin").cumcount(ascending=False)
    last = per_cycle[rank_from_end == 0].set_index("bin")
    prev = per_cycle[rank_from_end == 1].set_index("bin")

    X["has_history"] = X.index.isin(last.index).astype(int)
    X["last_status"] = last["sev"].reindex(X.index).fillna(-1)
    X["prev_status"] = prev["sev"].reindex(X.index).fillna(-1)
    X["cycles_since_last"] = (target_cycle - last["cycle"]).reindex(X.index)
    counts = per_cycle.groupby("bin")["sev"]
    X["n_cycles_filed"] = counts.size().reindex(X.index).fillna(0)
    for name, sev in [("n_unsafe", 2), ("n_swarmp", 1), ("n_safe", 0)]:
        X[name] = counts.apply(lambda s, v=sev: int((s == v).sum())).reindex(X.index).fillna(0)
    X["frac_unsafe"] = (X["n_unsafe"] / X["n_cycles_filed"]).where(X["n_cycles_filed"] > 0)
    X["unsafe_streak"] = counts.apply(_unsafe_streak).reindex(X.index).fillna(0)
    X["days_vs_deadline_last"] = (last["first_obs"] - last["deadline"]).dt.days.reindex(X.index)
    X["n_initial_last_cycle"] = last["n_initial"].reindex(X.index).fillna(0)

    nrf = hist[hist["is_nrf"]]
    X["n_nrf_cycles"] = nrf.groupby("bin")["cycle"].nunique().reindex(X.index).fillna(0)
    X["nrf_prev_cycle"] = X.index.isin(nrf.loc[nrf["cycle"] == target_cycle - 1, "bin"]).astype(int)

    # Amended / Subsequent filings within the last filed cycle, observable before the cutoff.
    followups = hist[hist["filing_type"].isin(["Amended", "Subsequent"])]
    last_cycle = last["cycle"].rename("last_cycle")
    fu = followups.join(last_cycle, on="bin")
    fu = fu[fu["cycle"] == fu["last_cycle"]]
    X["n_amended_last"] = fu[fu["filing_type"] == "Amended"].groupby("bin").size().reindex(X.index).fillna(0)
    X["n_subsequent_last"] = fu[fu["filing_type"] == "Subsequent"].groupby("bin").size().reindex(X.index).fillna(0)

    # Status as of the cutoff, reconstructed from the latest classified filing of any type (this is what the
    # dataset's prior_status field records, but taken only from filings observable before the cutoff).
    classified = hist[hist["severity"].notna()].sort_values(["bin", "observed_on"])
    latest_date = classified.groupby("bin")["observed_on"].transform("max")
    at_cutoff = classified[classified["observed_on"] == latest_date].groupby("bin")["severity"].max()
    X["status_at_cutoff"] = at_cutoff.reindex(X.index).fillna(-1)
    X["repaired_since_last"] = ((X["last_status"] == 2) & (X["status_at_cutoff"] < 2)).astype(int)
    X["years_since_last_filing"] = ((cutoff - classified.groupby("bin")["observed_on"].max()).dt.days / 365.25
                                    ).reindex(X.index)

    # Static location attributes (block/borough do not change over time), from any record of the BIN.
    static = fac.groupby("bin").agg(borough_code=("borough_code", "first"), subcycle=("subcycle", "first"))
    X["borough_code"] = static["borough_code"].reindex(X.index)
    X["subcycle_code"] = static["subcycle"].map({"A": 0, "B": 1, "C": 2}).reindex(X.index)

    # Wall construction as described in the latest pre-cutoff filing that reports it.
    walls = hist[hist["exterior_wall_type_s_"].notna() | hist["exterior_wall_material_s_"].notna()]
    walls = walls.sort_values("observed_on").groupby("bin").tail(1).set_index("bin")
    wall_text = (walls["exterior_wall_type_s_"].fillna("") + ";" + walls["exterior_wall_material_s_"].fillna(""))
    wall_text = wall_text.str.upper().reindex(X.index).fillna("")
    for key, token in WALL_TOKENS.items():
        X[f"wall_{key}"] = wall_text.str.contains(token, regex=False).astype(int)

    return X[FACADE_FEATURES].astype(float)
