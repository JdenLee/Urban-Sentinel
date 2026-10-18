"""Fetch the perpendicular baseline at the window centre for each granule in a manifest.

B_perp varies by only a few percent across a 45 km window, so one value per epoch
(the same simplification opera-utils `reformat_stack` makes) is enough to fit a
per-pixel DEM-error term: residual height error dh shows up as
LOS = B_perp * dh / (R * sin(theta)), which matters for high-rise roof scatterers.

Usage:
  ml/insar/.venv/bin/python ml/insar/fetch_bperp.py --stack-dir data/insar/F08622_nyc
Writes <stack-dir>/bperp.csv (granule, bperp_m).
"""

from __future__ import annotations

import argparse
import logging
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pandas as pd
import xarray as xr

from download_subset import open_signed

log = logging.getLogger("fetch_bperp")


def _one(args: tuple[str, int, int]) -> float:
    url, row, col = args
    for attempt in range(4):
        try:
            with open_signed(url) as f, \
                 xr.open_dataset(f, engine="h5netcdf", group="corrections") as dc:
                return float(dc["perpendicular_baseline"].isel(y=row, x=col).values)
        except Exception as e:  # noqa: BLE001 - network retries
            if attempt == 3:
                log.error("failed %s: %r", url.rsplit("/", 1)[-1], e)
                return float("nan")
            time.sleep(5 * 2**attempt)
    return float("nan")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--stack-dir", type=Path, required=True)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    man = pd.read_csv(args.stack_dir / "manifest.csv")
    row = int((man["row_start"].iloc[0] + man["row_stop"].iloc[0]) // 2)
    col = int((man["col_start"].iloc[0] + man["col_stop"].iloc[0]) // 2)
    out = args.stack_dir / "bperp.csv"
    done = pd.read_csv(out) if out.exists() else pd.DataFrame(columns=["granule", "bperp_m"])
    todo = man[~man["granule"].isin(done.dropna()["granule"])]
    with ProcessPoolExecutor(args.workers) as ex:
        vals = list(ex.map(_one, [(u, row, col) for u in todo["url"]]))
    new = pd.DataFrame({"granule": todo["granule"], "bperp_m": vals})
    res = pd.concat([done.dropna(), new]).drop_duplicates("granule", keep="last")
    res.to_csv(out, index=False)
    log.info("Wrote %s (%d rows, %d missing) at window centre row %d col %d",
             out, len(res), int(res["bperp_m"].isna().sum()), row, col)


if __name__ == "__main__":
    main()
