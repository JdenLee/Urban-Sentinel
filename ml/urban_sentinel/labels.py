"""Outcome definition.

y = 1 when a building's Initial FISP filing(s) in the target cycle record an UNSAFE façade condition
(worst status if several Initial filings exist), 0 for SAFE or SWARMP. The label is the status a licensed
inspector (QEWI) recorded at the mandated inspection; it is observable on the filing date. It is NOT a
structural-collapse label. Buildings that never file in the cycle have no label and are reported
separately (missing not at random).
"""
from __future__ import annotations

import pandas as pd


def build_labels(fac: pd.DataFrame, target_cycle: int) -> pd.DataFrame:
    ini = fac[(fac["cycle"] == target_cycle) & fac["filing_type"].eq("Initial") & fac["severity"].notna()]
    grouped = ini.groupby("bin")
    labels = pd.DataFrame({
        "y": grouped["severity"].max().eq(2).astype(int),
        "worst_severity": grouped["severity"].max().astype(int),
        "first_filed_on": grouped["observed_on"].min(),
        "n_initial": grouped.size(),
        "subcycle": grouped["subcycle"].agg(lambda s: s.mode().iat[0] if s.notna().any() else None),
        "borough_code": grouped["borough_code"].first(),
    })
    labels["target_cycle"] = target_cycle
    return labels


def never_filers(fac: pd.DataFrame, target_cycle: int) -> pd.Index:
    """BINs marked No Report Filed in the cycle that never submitted a classified Initial filing."""
    cyc = fac[fac["cycle"] == target_cycle]
    nrf = set(cyc.loc[cyc["is_nrf"], "bin"])
    filed = set(cyc.loc[cyc["filing_type"].eq("Initial") & cyc["severity"].notna(), "bin"])
    return pd.Index(sorted(nrf - filed), name="bin")
