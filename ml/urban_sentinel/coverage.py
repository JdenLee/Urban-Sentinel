"""Why each map footprint is or isn't scored, and which unscored footprints are the same building as a filing.

The model predicts a building's next FISP (Local Law 11) façade filing, so only buildings in the program get a
prediction. Every other footprint gets an explicit reason instead of a silent gray:

- recorded:       already filed this cycle, so the recorded result is shown instead of a prediction
- alias:          the façade filing is under another BIN on the same tax lot and that BIN has no footprint of its
                  own, i.e. it is the same building; it inherits that filing's score
- stale:          last FISP filing before the previous cycle
- low_rise:       six stories or fewer (outside Local Law 11)
- shared_lot:     another building on the lot carries the filing (different footprint), so nothing to inherit
- public_owner:   federal, state or Port Authority property, which does not file with NYC DOB
- newer_building: completed recently with no filing on record yet
- no_filing:      taller than six stories, privately owned, but no filing on record
- unknown:        no PLUTO data to classify
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

from . import socrata
from .config import DATASETS, RAW_DIR

REASON_LABELS = {
    "scored": "Scored: awaiting its next façade inspection",
    "recorded": "Already filed this cycle: recorded result shown",
    "alias": "Scored through the façade filing for the same building (another BIN on this lot)",
    "stale": "Last façade filing before 2015; not active in recent cycles",
    "low_rise": "Six stories or fewer: outside the façade program (Local Law 11)",
    "shared_lot": "Another building on this lot carries the façade filing",
    "public_owner": "Federal, state or Port Authority property: does not file with NYC DOB",
    "newer_building": "Newer building: no façade filing on record yet",
    "no_filing": "Taller than six stories, but no façade filing on record",
    "unknown": "Not enough building data to classify",
}
PUBLIC_OWNER = re.compile(r"PORT AUTH|UNITED STATES|U\.?S\.? GENERAL SERV|GENERAL SERVICES? ADMIN|STATE OF NEW YORK|"
                          r"NEW YORK STATE|LOWER MANHATTAN DEVELOPMENT|BATTERY PARK CITY AUTH|METROPOLITAN TRANSPORTATION",
                          re.IGNORECASE)
NEWER_BUILDING_YEAR = 2016


def footprint_bins(path: str | Path) -> list[str]:
    feats = json.loads(Path(path).read_text())["features"]
    return sorted({str(f["properties"]["bin"]).split(".")[0] for f in feats if f.get("properties", {}).get("bin")})


def _cached_in_query(name: str, dataset: str, select: str, field: str, values: list[str], chunk: int = 250) -> pd.DataFrame:
    path, keys = RAW_DIR / f"{name}.csv.gz", RAW_DIR / f"{name}.keys.txt"
    if path.exists() and keys.exists() and keys.read_text() == ",".join(values):  # cache keyed by the request
        return pd.read_csv(path, dtype=str)
    rows: list[dict] = []
    for i in range(0, len(values), chunk):
        rows += socrata.query(DATASETS[dataset], select=select, where=f"{field} in({','.join(values[i:i + chunk])})")
    frame = pd.DataFrame(rows, dtype=str)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False, compression="gzip")
    keys.write_text(",".join(values))
    return frame


def _int_str(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").astype("Int64").astype("string")


def classify(fac: pd.DataFrame, records: dict[str, dict], bins: list[str], current_cycle: int,
             name: str = "map") -> dict:
    """Reason per footprint BIN, plus alias links (footprint BIN -> filing BIN) for the same building."""
    foot = _cached_in_query(f"footprints_{name}", "footprints", "bin,mappluto_bbl,base_bbl", "bin", bins)
    foot["bin"] = _int_str(foot["bin"])
    foot["bbl"] = _int_str(foot["mappluto_bbl"].fillna(foot["base_bbl"]))
    bbl_of = foot.dropna(subset=["bbl"]).drop_duplicates("bin").set_index("bin")["bbl"]
    pluto = _cached_in_query(f"pluto_{name}", "pluto", "bbl,numfloors,ownertype,ownername,yearbuilt",
                             "bbl", sorted(set(bbl_of.dropna())))
    pluto["bbl"] = _int_str(pluto["bbl"])
    pluto = pluto.drop_duplicates("bbl").set_index("bbl")

    filed = fac.dropna(subset=["borough_code", "block", "lot"])
    filing_bbl = _int_str(filed["borough_code"].astype(int) * 10**9 + pd.to_numeric(filed["block"], errors="coerce") * 10**4
                          + pd.to_numeric(filed["lot"], errors="coerce"))
    filing_bins_on_lot = pd.Series(filed["bin"].to_numpy(), index=filing_bbl.to_numpy()).groupby(level=0).agg(lambda s: sorted(set(s)))
    last_cycle = fac.groupby("bin")["cycle"].max()
    on_map = set(bins)

    reasons: dict[str, str] = {}
    aliases: dict[str, str] = {}
    for b in bins:
        rec = records.get(b)
        if rec is not None and rec.get("prediction"):
            reasons[b] = "scored"
            continue
        if rec is not None and rec["fisp"].get("current_cycle_filed"):
            reasons[b] = "recorded"
            continue
        bbl = bbl_of.get(b)
        lot_filers = [x for x in filing_bins_on_lot.get(bbl, []) if x != b] if bbl is not None else []
        unmapped = [x for x in lot_filers if x not in on_map and x in records]
        if b not in last_cycle.index and len(unmapped) == 1:
            reasons[b] = "alias"
            aliases[b] = unmapped[0]
            continue
        if b in last_cycle.index and last_cycle[b] < current_cycle - 2:
            reasons[b] = "stale"
            continue
        info = pluto.loc[bbl] if bbl is not None and bbl in pluto.index else None
        floors = pd.to_numeric(info["numfloors"], errors="coerce") if info is not None else float("nan")
        if pd.notna(floors) and floors <= 6:
            reasons[b] = "low_rise"
        elif lot_filers:
            reasons[b] = "shared_lot"
        elif info is not None and (info.get("ownertype") == "O" or PUBLIC_OWNER.search(str(info.get("ownername") or ""))):
            reasons[b] = "public_owner"
        elif info is not None and pd.to_numeric(info.get("yearbuilt"), errors="coerce") >= NEWER_BUILDING_YEAR:
            reasons[b] = "newer_building"
        elif pd.notna(floors):
            reasons[b] = "no_filing"
        else:
            reasons[b] = "unknown"
    counts = pd.Series(reasons).value_counts().to_dict()
    return {"reasons": reasons, "aliases": aliases, "counts": {k: int(v) for k, v in counts.items()},
            "labels": REASON_LABELS}
