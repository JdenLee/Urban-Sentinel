"""Additional municipal records as point-in-time features (Step 2 ablations).

Each source is pulled citywide restricted to façade/structure-relevant codes, then filtered to FISP buildings.
Only events dated strictly before the cutoff are counted. Outcome "echo" codes (issued because an UNSAFE report
was filed) are legitimate history when they refer to earlier cycles, but are tracked separately so a buffer
sensitivity check can drop the ones close to the cutoff.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import socrata
from .config import DATASETS, RAW_DIR
from .features import LeakageError
from .ingest import facade_bbls, load_pluto, valid_bin

DOB_CODES = {
    "facade": ["LL10/80", "LL1080", "L1198", "LL1198", "LL11/98", "FISP", "FISPHAZ"],
    "fisp_compliance": ["FISPNRF", "FISPFCS"],
    "structural": ["UB", "IMEGNCY", "COMPBLD", "CMQ"],
}
ECB_CODES = {
    "wall": ["104", "204", "304", "B06", "B6A", "BR5"],
    "report": ["230", "227"],
    "unsafe_measures": ["1E4", "1E3"],
    "shed": ["223", "131", "B49", "B50", "B51", "B52", "B53", "2F2"],
}
COMPLAINT_CODES = {
    "debris": ["10"], "wall_bulging": ["54"], "structural": ["30"], "shed": ["23"],
    "maintenance": ["73"], "suspended_scaffold": ["1E"], "sign": ["50"], "unsafe_notification": ["2L"],
}
GROUPS = {"dob": list(DOB_CODES), "ecb": list(ECB_CODES), "cmp": list(COMPLAINT_CODES)}
ECHO = {("dob", "facade"), ("ecb", "unsafe_measures"), ("cmp", "unsafe_notification")}
WINDOWS_YEARS = (1, 5)


def _sql_in(codes) -> str:
    return ",".join(f"'{c}'" for c in codes)


def _events(name, dataset, code_field, groups, date_field, date_format, refresh=False) -> pd.DataFrame:
    codes = [c for cs in groups.values() for c in cs]
    raw = socrata.cached_query(name, DATASETS[dataset],
                               select=f"bin,{date_field},{code_field}",
                               where=f"{code_field} in({_sql_in(codes)})", refresh=refresh)
    df = raw[valid_bin(raw["bin"])].copy()
    df["date"] = pd.to_datetime(df[date_field], format=date_format, errors="coerce")
    df = df[df["date"].between("1990-01-01", pd.Timestamp.now())]  # drops junk years such as 0000 / 3321
    lookup = {c: g for g, cs in groups.items() for c in cs}
    df["group"] = df[code_field].str.strip().map(lookup)
    return df.dropna(subset=["group"])[["bin", "date", "group"]]


def load_events(refresh: bool = False) -> dict[str, pd.DataFrame]:
    return {
        "dob": _events("dob_violations_facade", "dob_violations", "violation_type_code", DOB_CODES, "issue_date", "%Y%m%d", refresh),
        "ecb": _events("ecb_violations_facade", "ecb_violations", "infraction_code1", ECB_CODES, "issue_date", "%Y%m%d", refresh),
        "cmp": _events("complaints_facade", "complaints", "complaint_category", COMPLAINT_CODES, "date_entered", "%m/%d/%Y", refresh),
    }


def event_features(events: dict[str, pd.DataFrame], bins: pd.Index, cutoff: pd.Timestamp,
                   echo_buffer_days: int = 0, sources=("dob", "ecb", "cmp")) -> pd.DataFrame:
    cutoff = pd.Timestamp(cutoff)
    X = pd.DataFrame(index=pd.Index(bins, name="bin"))
    for src in sources:
        ev = events[src]
        ev = ev[ev["bin"].isin(X.index) & (ev["date"] < cutoff)]
        if echo_buffer_days:
            echo_groups = [g for s, g in ECHO if s == src]
            ev = ev[~(ev["group"].isin(echo_groups) & (ev["date"] >= cutoff - pd.Timedelta(days=echo_buffer_days)))]
        if len(ev) and ev["date"].max() >= cutoff:
            raise LeakageError(f"{src} event on/after cutoff")
        age_days = (cutoff - ev["date"]).dt.days
        for group in GROUPS[src]:  # fixed column set regardless of which events exist before this cutoff
            g = ev["group"] == group
            for years in WINDOWS_YEARS:
                in_window = g & (age_days <= 365.25 * years)
                X[f"{src}_{group}_{years}y"] = ev[in_window].groupby("bin").size().reindex(X.index).fillna(0)
            X[f"{src}_{group}_ever"] = ev[g].groupby("bin").size().reindex(X.index).fillna(0)
            X[f"{src}_{group}_years_since"] = (age_days[g].groupby(ev.loc[g, "bin"]).min() / 365.25).reindex(X.index)
    return X.astype(float)


def building_attributes(fac: pd.DataFrame, bins: pd.Index, cutoff: pd.Timestamp) -> pd.DataFrame:
    """PLUTO is a current snapshot: only slowly-changing attributes are used, and age is computed at the cutoff.
    Buildings completed after the cutoff are blanked (their attributes would be from the future)."""
    pluto = load_pluto(facade_bbls(fac))
    bbls = facade_bbls(fac).reindex(bins)
    attrs = pluto.reindex(bbls.to_numpy())
    attrs.index = pd.Index(bins, name="bin")
    X = pd.DataFrame(index=attrs.index)
    year = pd.to_numeric(attrs["yearbuilt"], errors="coerce").where(lambda s: s > 1700)
    year = year.where(year <= pd.Timestamp(cutoff).year)
    X["bldg_age"] = pd.Timestamp(cutoff).year - year
    X["num_floors"] = pd.to_numeric(attrs["numfloors"], errors="coerce").where(year.notna())
    X["lot_area"] = np.log1p(pd.to_numeric(attrs["lotarea"], errors="coerce"))
    X["historic_district"] = attrs["histdist"].notna().astype(float)
    X["landmark"] = attrs["landmark"].notna().astype(float)
    cls = attrs["bldgclass"].fillna("").str[:1]
    for letter, name in [("D", "elevator_apts"), ("C", "walkup_apts"), ("O", "office"), ("R", "condo"),
                         ("K", "store"), ("H", "hotel")]:
        X[f"class_{name}"] = cls.eq(letter).astype(float)
    return X


RAW_EVENT_FILES = [RAW_DIR / f"{n}.csv.gz" for n in ("dob_violations_facade", "ecb_violations_facade", "complaints_facade")]
