"""Remote-subset OPERA DISP-S1 granules for a small bbox, without downloading full frames.

`opera-utils disp-s1-download` over HTTPS fetches every ~420 MB granule in full
before cropping (~41 GB for F08622 pre-2020), and opera-utils' own fsspec/aiohttp
remote reader fails here with 401 because aiohttp drops the Authorization header on
the cross-host redirect to urs.earthdata.nasa.gov. Instead, each granule URL is
resolved once with `requests` (which re-applies ~/.netrc credentials per host) to
its short-lived signed CloudFront URL, and that URL is read with unauthenticated
HTTP byte ranges, so only the HDF5 chunks that intersect the window are transferred
(~20 MB per granule for the NYC-wide window, vs 420 MB).

Earthdata prerequisites (one-time, done by the account owner):
  ~/.netrc entry for urs.earthdata.nasa.gov (password double-quoted if it contains a backslash, quote or #),
  "Study Area" set in the Earthdata profile, and the ASF data-access app
  (client_id BO_n7nTIlMljdvU6kRRB3g) pre-authorized.

Outputs (under --out-dir):
  granules/<granule>.nc   window subset of the layers in KEEP_VARS / KEEP_CORRECTIONS
  static_los_enu.tif      LOS east/north/up unit vectors (DISP-S1-STATIC)
  static_layover_shadow_mask.tif
  manifest.csv            one row per granule (dates, generation, url, status)

Usage:
  ml/insar/.venv/bin/python ml/insar/download_subset.py \
      --frame-id 8622 --bbox -74.205 40.532 -73.703 40.920 \
      --start 2016-07-01 --end 2020-02-21 --out-dir data/insar/F08622_nyc
"""

from __future__ import annotations

import argparse
import logging
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import fsspec
import numpy as np
import pandas as pd
import rasterio
import requests
import xarray as xr
from opera_utils.disp import search
from pyproj import Transformer
from rasterio.windows import from_bounds

log = logging.getLogger("download_subset")

KEEP_VARS = [
    "displacement",
    "temporal_coherence",
    "phase_similarity",
    "recommended_mask",
    "persistent_scatterer_mask",
    "water_mask",
]
KEEP_CORRECTIONS = ["solid_earth_tide"]
STATIC_COLLECTION = "C3959290248-ASF"  # OPERA_L3_DISP-S1-STATIC_V1
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
# 256 KB blocks: ~1.6x over-fetch vs exact chunk reads, but ~20x fewer requests.
FSSPEC_KW = {"cache_type": "blockcache", "block_size": 256 * 2**10}


def dedupe_products(products: list) -> list:
    """Keep only the newest generation of each (reference, secondary) pair."""
    best: dict[tuple, object] = {}
    for p in products:
        key = (p.reference_datetime, p.secondary_datetime)
        if key not in best or p.generation_datetime > best[key].generation_datetime:
            best[key] = p
    return sorted(best.values(), key=lambda p: p.secondary_datetime)


def window_from_bbox(product, bbox: tuple[float, float, float, float]) -> tuple[slice, slice]:
    """Row/col window covering all four bbox corners (the UTM grid is not lon/lat aligned)."""
    w, s, e, n = bbox
    rc = [product.lonlat_to_rowcol(lon, lat) for lon, lat in [(w, s), (w, n), (e, s), (e, n)]]
    rows, cols = zip(*rc)
    return slice(min(rows), max(rows) + 1), slice(min(cols), max(cols) + 1)


def open_signed(url: str, session: requests.Session | None = None):
    """Resolve an ASF/Earthdata URL to its signed URL and open it for byte-range reads."""
    session = session or requests.Session()  # picks up ~/.netrc per redirect host
    r = session.get(url, headers={"Range": "bytes=0-0"}, timeout=120)
    if r.status_code != 206:
        hint = r.url.split("error_msg=")[-1][:200] if "error_msg=" in r.url else r.text[:200]
        raise PermissionError(f"HTTP {r.status_code} resolving {url.rsplit('/', 1)[-1]}: {hint}")
    size = int(r.headers["Content-Range"].rsplit("/", 1)[-1])
    return fsspec.filesystem("https").open(r.url, mode="rb", size=size, **FSSPEC_KW)


def _subset_one(url: str, rows: slice, cols: slice, outpath: Path, retries: int = 4) -> str:
    if outpath.exists():
        return "exists"
    tmp = outpath.with_suffix(".part")
    for attempt in range(retries):
        try:
            with open_signed(url) as fobj:
                with xr.open_dataset(fobj, engine="h5netcdf") as ds:
                    keep = [v for v in KEEP_VARS if v in ds]
                    sub = ds[keep].isel(y=rows, x=cols).load()
                    sub.attrs.update(ds.attrs)
                with xr.open_dataset(fobj, engine="h5netcdf", group="corrections") as dc:
                    corr = dc[[v for v in KEEP_CORRECTIONS if v in dc]].isel(y=rows, x=cols).load()
                    if "reference_point" in dc:
                        for k in ("rows", "cols", "latitudes", "longitudes"):
                            if k in dc["reference_point"].attrs:
                                sub.attrs[f"reference_point_{k}"] = np.asarray(
                                    dc["reference_point"].attrs[k]).ravel()[0].item()
            # float64 metres -> float32 keeps sub-micron precision and halves the size
            sub["displacement"] = sub["displacement"].astype(np.float32)
            enc = {v: {"zlib": True, "complevel": 4} for v in sub.data_vars if v != "spatial_ref"}
            sub.to_netcdf(tmp, engine="h5netcdf", encoding=enc)
            corr.to_netcdf(tmp, mode="a", group="corrections", engine="h5netcdf",
                           encoding={v: {"zlib": True, "complevel": 4} for v in corr.data_vars})
            tmp.rename(outpath)
            return "ok"
        except Exception as e:  # network/auth hiccups: retry with backoff
            tmp.unlink(missing_ok=True)
            if attempt == retries - 1:
                log.error("FAILED %s: %r", url.rsplit("/", 1)[-1], e)
                return f"failed: {e!r}"[:300]
            time.sleep(5 * 2**attempt)
    return "failed"


def fetch_static(frame_id: int, bbox, out_dir: Path) -> None:
    r = requests.get(
        CMR,
        params={"collection_concept_id": STATIC_COLLECTION, "page_size": 10,
                "readable_granule_name": f"*F{frame_id:05d}*",
                "options[readable_granule_name][pattern]": "true"},
        timeout=60,
    )
    r.raise_for_status()
    entries = r.json()["feed"]["entry"]
    if not entries:
        log.warning("No DISP-S1-STATIC granule for F%05d", frame_id)
        return
    links = [l["href"] for l in entries[0]["links"] if l["href"].endswith(".tif")
             and "/BROWSE/" not in l["href"]]
    for suffix, name in [("_line_of_sight_enu.tif", "static_los_enu.tif"),
                         ("_layover_shadow_mask.tif", "static_layover_shadow_mask.tif")]:
        out = out_dir / name
        url = next((u for u in links if u.endswith(suffix)), None)
        if out.exists() or url is None:
            continue
        with open_signed(url) as fobj, rasterio.open(fobj) as src:
            to_crs = Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)
            xs, ys = to_crs.transform([bbox[0], bbox[0], bbox[2], bbox[2]],
                                      [bbox[1], bbox[3], bbox[1], bbox[3]])
            win = from_bounds(min(xs) - 90, min(ys) - 90, max(xs) + 90, max(ys) + 90,
                              transform=src.transform).round_offsets().round_lengths()
            data = src.read(window=win)
            prof = src.profile.copy()
            prof.update(width=data.shape[2], height=data.shape[1],
                        transform=src.window_transform(win), compress="deflate", tiled=False)
            prof.pop("blockxsize", None), prof.pop("blockysize", None)
            with rasterio.open(out, "w", **prof) as dst:
                dst.write(data)
                dst.update_tags(**src.tags())
                for b in range(1, src.count + 1):
                    dst.set_band_description(b, src.descriptions[b - 1] or f"band{b}")
        log.info("Wrote %s %s", out.name, data.shape)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--frame-id", type=int, default=8622)
    ap.add_argument("--bbox", type=float, nargs=4, required=True, metavar=("W", "S", "E", "N"))
    ap.add_argument("--start", type=datetime.fromisoformat, default=datetime(2016, 7, 1))
    ap.add_argument("--end", type=datetime.fromisoformat, default=datetime(2020, 2, 21),
                    help="search end; feature code separately filters to secondary dates < cutoff")
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, default=None, help="only the first N granules (testing)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("opera_utils").setLevel(logging.WARNING)

    gran_dir = args.out_dir / "granules"
    gran_dir.mkdir(parents=True, exist_ok=True)
    products = dedupe_products(search(frame_id=args.frame_id, start_datetime=args.start,
                                      end_datetime=args.end))
    if args.limit:
        products = products[: args.limit]
    rows, cols = window_from_bbox(products[0], tuple(args.bbox))
    log.info("%d granules; window rows %s cols %s (%d x %d px)", len(products), rows, cols,
             rows.stop - rows.start, cols.stop - cols.start)

    fetch_static(args.frame_id, args.bbox, args.out_dir)

    t0 = time.time()
    status: dict[str, str] = {}
    # Processes, not threads: h5py holds a global lock during (remote) reads.
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(_subset_one, p.filename, rows, cols,
                          gran_dir / Path(p.filename).name): p for p in products}
        for i, fut in enumerate(as_completed(futs), 1):
            p = futs[fut]
            status[p.filename] = fut.result()
            if i % 5 == 0 or i == len(futs):
                log.info("%d/%d done (%.0fs elapsed)", i, len(futs), time.time() - t0)

    manifest = pd.DataFrame(
        {
            "granule": [Path(p.filename).name for p in products],
            "reference_datetime": [p.reference_datetime for p in products],
            "secondary_datetime": [p.secondary_datetime for p in products],
            "generation_datetime": [p.generation_datetime for p in products],
            "url": [p.filename for p in products],
            "status": [status.get(p.filename, "not run") for p in products],
            "row_start": rows.start, "row_stop": rows.stop,
            "col_start": cols.start, "col_stop": cols.stop,
        }
    )
    manifest.to_csv(args.out_dir / "manifest.csv", index=False)
    n_bad = int(manifest["status"].str.startswith("failed").sum())
    size = sum(f.stat().st_size for f in gran_dir.glob("*.nc")) / 1e6
    log.info("Done: %d ok/existing, %d failed, %.1f MB on disk", len(manifest) - n_bad, n_bad, size)


if __name__ == "__main__":
    main()
