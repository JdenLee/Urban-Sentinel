"""Build the FISP building universe with one centroid per BIN.

Sources (NYC Open Data / Socrata, no auth needed):
  * xubg-57si  DOB NOW Safety - Facades Compliance Filings (FISP)  -> distinct BIN + BBL
  * 5zhs-2jue  Building Footprints                                -> footprint centroid by BIN
  * 64uk-42ks  PLUTO                                              -> lot lat/lon fallback by BBL

Output: data/insar/ref/fisp_buildings.csv.gz with columns
  bin, bbl, borough, lon, lat, x_utm18n, y_utm18n, loc_source, footprint_area_m2, height_roof_ft

Usage:
  ml/insar/.venv/bin/python ml/insar/fetch_buildings.py [--out data/insar/ref/fisp_buildings.csv.gz]
"""

from __future__ import annotations

import argparse
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import pandas as pd
import requests

if TYPE_CHECKING:
    import geopandas as gpd

SOCRATA = "https://data.cityofnewyork.us/resource"
FISP_ID = "xubg-57si"
FOOTPRINTS_ID = "5zhs-2jue"
PLUTO_ID = "64uk-42ks"
BORO_CODE = {"MANHATTAN": 1, "BRONX": 2, "BROOKLYN": 3, "QUEENS": 4, "STATEN ISLAND": 5}
# DOB assigns these "million BINs" as placeholders when a real BIN is unknown;
# they do not identify a single building, so they never get a footprint.
PLACEHOLDER_BINS = {1000000, 2000000, 3000000, 4000000, 5000000}
BATCH = 300

log = logging.getLogger("fetch_buildings")
REPO = Path(__file__).resolve().parents[2]


def _get(dataset: str, params: dict, retries: int = 5) -> list[dict]:
    url = f"{SOCRATA}/{dataset}.json"
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=120)
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError) as e:
            wait = 2**attempt
            log.warning("Socrata %s failed (%s); retry in %ss", dataset, e, wait)
            time.sleep(wait)
    raise RuntimeError(f"Socrata query to {dataset} failed after {retries} tries")


def fetch_fisp_bins(cache: Path | None = None) -> pd.DataFrame:
    rows, offset = [], 0
    while cache is None:
        page = _get(
            FISP_ID,
            {
                "$select": "bin, borough, block, lot",
                "$group": "bin, borough, block, lot",
                "$order": "bin",
                "$limit": 50000,
                "$offset": offset,
            },
        )
        rows += page
        if len(page) < 50000:
            break
        offset += 50000
    # Match the original grouped query using the presentation's frozen source snapshot.
    df = (pd.read_csv(cache, dtype=str)[["bin", "borough", "block", "lot"]].drop_duplicates()
          if cache is not None else pd.DataFrame(rows))
    df["bin"] = pd.to_numeric(df["bin"], errors="coerce")
    df = df.dropna(subset=["bin"])
    df["bin"] = df["bin"].astype(np.int64)
    boro = df["borough"].str.upper().str.strip().map(BORO_CODE)
    block = pd.to_numeric(df["block"], errors="coerce")
    lot = pd.to_numeric(df["lot"], errors="coerce")
    df["bbl"] = (boro * 1_000_000_000 + block * 10_000 + lot).astype("Int64")
    # A BIN can appear with several BBLs across filings (condo lots, typos);
    # keep the most frequent one per BIN.
    df = (
        df.groupby(["bin", "bbl"], dropna=False)
        .size()
        .rename("n")
        .reset_index()
        .sort_values(["bin", "n"], ascending=[True, False])
        .drop_duplicates("bin")
        .merge(df[["bin", "borough"]].drop_duplicates("bin"), on="bin")
    )
    log.info("FISP universe: %d distinct BINs", len(df))
    return df[["bin", "bbl", "borough"]]


def _footprint_batch(bins: list[int]) -> list[dict]:
    where = "bin in (" + ",".join(f"'{b}'" for b in bins) + ")"
    return _get(
        FOOTPRINTS_ID,
        {"$select": "bin, the_geom, height_roof", "$where": where, "$limit": 50000},
    )


def fetch_footprints(bins: list[int]) -> gpd.GeoDataFrame:
    import geopandas as gpd
    from shapely.geometry import shape
    batches = [bins[i : i + BATCH] for i in range(0, len(bins), BATCH)]
    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(_footprint_batch, batches))
    recs = [r for batch in results for r in batch if r.get("the_geom")]
    gdf = gpd.GeoDataFrame(
        {
            "bin": [int(r["bin"]) for r in recs],
            "height_roof_ft": [float(r.get("height_roof") or np.nan) for r in recs],
        },
        geometry=[shape(r["the_geom"]) for r in recs],
        crs="EPSG:4326",
    ).to_crs("EPSG:32618")
    # Rare duplicate BINs (multi-part records): dissolve so one BIN = one shape.
    gdf = gdf.dissolve(by="bin", aggfunc={"height_roof_ft": "max"}).reset_index()
    log.info("Footprints found for %d / %d BINs", len(gdf), len(bins))
    return gdf


def fetch_pluto(bbls: list[int], cache: Path | None = None) -> pd.DataFrame:
    def batch(chunk: list[int]) -> list[dict]:
        where = "bbl in (" + ",".join(f"'{b}'" for b in chunk) + ")"
        return _get(
            PLUTO_ID,
            {"$select": "bbl, latitude, longitude", "$where": where, "$limit": 50000},
        )

    chunks = [bbls[i : i + BATCH] for i in range(0, len(bbls), BATCH)]
    if cache is not None:
        df = pd.read_csv(cache, dtype=str)[["bbl", "latitude", "longitude"]]
    else:
        with ThreadPoolExecutor(max_workers=4) as ex:
            rows = [r for res in ex.map(batch, chunks) for r in res]
        df = pd.DataFrame(rows, columns=["bbl", "latitude", "longitude"])
    df["bbl"] = pd.to_numeric(df["bbl"], errors="coerce").round().astype("Int64")
    df["lat"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["lon"] = pd.to_numeric(df["longitude"], errors="coerce")
    return df.dropna(subset=["lat", "lon"]).drop_duplicates("bbl")[["bbl", "lon", "lat"]]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--out", type=Path, default=REPO / "data/insar/ref/fisp_buildings.csv.gz")
    p.add_argument("--facades-cache", type=Path, help="Reuse a municipal façade snapshot instead of refreshing")
    p.add_argument("--pluto-cache", type=Path, help="Reuse the same municipal PLUTO snapshot")
    p.add_argument("--footprints-cache", type=Path, help="Persist/reuse projected footprint geometries for this run")
    args = p.parse_args()
    import geopandas as gpd
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    fisp = fetch_fisp_bins(args.facades_cache)
    real = sorted(set(fisp["bin"]) - PLACEHOLDER_BINS)
    if args.footprints_cache and args.footprints_cache.exists():
        fp = gpd.read_file(args.footprints_cache).to_crs("EPSG:32618")
    else:
        fp = fetch_footprints(real)
        if args.footprints_cache:
            args.footprints_cache.parent.mkdir(parents=True, exist_ok=True)
            fp.to_file(args.footprints_cache, driver="GeoJSON")
    cent = fp.geometry.centroid
    fp_df = pd.DataFrame(
        {
            "bin": fp["bin"],
            "x_utm18n": cent.x,
            "y_utm18n": cent.y,
            "footprint_area_m2": fp.geometry.area,
            "height_roof_ft": fp["height_roof_ft"],
            "loc_source": "footprint",
        }
    )
    out = fisp.merge(fp_df, on="bin", how="left")

    missing = out["x_utm18n"].isna() & out["bbl"].notna() & ~out["bin"].isin(PLACEHOLDER_BINS)
    if missing.any():
        pl = fetch_pluto(sorted(out.loc[missing, "bbl"].astype(int).unique()), args.pluto_cache)
        pl_xy = gpd.GeoSeries(gpd.points_from_xy(pl["lon"], pl["lat"]), crs="EPSG:4326").to_crs(
            "EPSG:32618"
        )
        pl = pl.assign(px=pl_xy.x.values, py=pl_xy.y.values)
        out = out.merge(pl[["bbl", "px", "py"]], on="bbl", how="left")
        fill = out["x_utm18n"].isna() & out["px"].notna()
        out.loc[fill, "x_utm18n"] = out.loc[fill, "px"]
        out.loc[fill, "y_utm18n"] = out.loc[fill, "py"]
        out.loc[fill, "loc_source"] = "pluto_lot"
        out = out.drop(columns=["px", "py"])
        log.info("PLUTO lot-centroid fallback filled %d BINs", int(fill.sum()))

    has_xy = out["x_utm18n"].notna()
    ll = gpd.GeoSeries(
        gpd.points_from_xy(out.loc[has_xy, "x_utm18n"], out.loc[has_xy, "y_utm18n"]),
        crs="EPSG:32618",
    ).to_crs("EPSG:4326")
    out.loc[has_xy, "lon"] = ll.x.values
    out.loc[has_xy, "lat"] = ll.y.values
    out["loc_source"] = out["loc_source"].fillna("none")
    log.info("Location sources: %s", out["loc_source"].value_counts().to_dict())

    args.out.parent.mkdir(parents=True, exist_ok=True)
    cols = ["bin", "bbl", "borough", "lon", "lat", "x_utm18n", "y_utm18n", "loc_source",
            "footprint_area_m2", "height_roof_ft"]
    out[cols].to_csv(args.out, index=False, float_format="%.6f")
    log.info("Wrote %s (%d rows)", args.out, len(out))


if __name__ == "__main__":
    main()
