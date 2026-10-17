"""Export per-building InSAR displacement time series (2016 -> latest) for the frontend's history view.

Visualization only: the ablation found no predictive gain, so none of this feeds the model, and the
pre-cutoff ML feature file (build_features.py) is unaffected.

Per FISP BIN, per epoch:
  disp  median LOS displacement (mm) of the building's good pixels (within 50 m of the footprint centroid,
        100 m fallback), relative to the NYC-window median, after solid-earth-tide correction and
        reference-date chaining. This is the same processing as build_features.py, just without the cutoff.
  base  the ~2 km neighbourhood background at the building (300 m block medians, 2.1 km moving median),
        so "building vs neighbourhood" cancels the shared atmosphere and the long-wavelength ramp.
and vel_hp: the full-period velocity of (disp - base) from a linear + annual (+ B_perp if available) fit.

Usage:
  ml/insar/.venv/bin/python ml/insar/export_series.py --stack-dir data/insar/F08622_nyc \
      --buildings data/insar/ref/fisp_buildings.csv.gz --out data/insar/movement_series.npz
Writes <out> (bins, dates, disp, base, vel_hp, n_px) and <out>.json (metadata for the API/frontend).
"""

from __future__ import annotations

import argparse
import json
import logging
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

import build_features as bf

log = logging.getLogger("export_series")
REPO = Path(__file__).resolve().parents[2]
NO_CUTOFF = pd.Timestamp("2100-01-01")


def fit_velocity(t: np.ndarray, y: np.ndarray, bperp: np.ndarray | None) -> float:
    ok = np.isfinite(y)
    if ok.sum() < 12:
        return np.nan
    cols = [np.ones(ok.sum()), t[ok], np.sin(2 * np.pi * t[ok]), np.cos(2 * np.pi * t[ok])]
    if bperp is not None:
        cols.append(bperp[ok] - bperp[ok].mean())
    coef, *_ = np.linalg.lstsq(np.column_stack(cols), y[ok], rcond=None)
    return float(coef[1])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--stack-dir", type=Path, required=True)
    ap.add_argument("--buildings", type=Path, default=REPO / "data/insar/ref/fisp_buildings.csv.gz")
    ap.add_argument("--out", type=Path, default=REPO / "data/insar/movement_series.npz")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    man, cum_mm, rec, land, x, y, attrs, stats = bf.load_stack(args.stack_dir, NO_CUTOFF)
    cum_mm, issues = bf.rebase_chain(cum_mm, man)
    for msg in issues:
        log.warning(msg)
    T, H, W = cum_mm.shape
    man, rec = man.iloc[:T], rec[:T]
    cum_mm *= 1000.0
    log.info("Stack: %d epochs, %s -> %s", T, man["secondary_datetime"].min().date(),
             man["secondary_datetime"].max().date())

    valid = np.isfinite(cum_mm) & rec & land[None]
    valid_frac = valid.mean(0)
    good = land & (valid_frac >= bf.MIN_VALID_FRAC) & (stats["mean_tcoh"] >= bf.MIN_MEAN_TCOH)
    ref_px = land & (valid_frac >= bf.REF_VALID_FRAC) & (stats["mean_tcoh"] >= bf.REF_MEAN_TCOH)
    if ref_px.sum() < 500:
        ref_px = good
    for i in range(T):  # per-epoch spatial reference, as in build_features.py
        cum_mm[i] -= np.median(cum_mm[i][valid[i] & ref_px])
    log.info("Good pixels: %d (%.1f%% of land)", good.sum(), 100 * good.sum() / max(1, land.sum()))

    # Buildings -> their good pixels (same rule as the feature file)
    b = pd.read_csv(args.buildings, dtype={"bin": str})
    b = b[b["x_utm18n"].notna()].reset_index(drop=True)
    gy, gx = np.nonzero(good)
    tree = cKDTree(np.c_[x[gx], y[gy]])
    pts = b[["x_utm18n", "y_utm18n"]].to_numpy()
    nb50 = tree.query_ball_point(pts, bf.R_BUILDING_M)
    nb100 = tree.query_ball_point(pts, bf.R_BUILDING_FALLBACK_M)

    # Neighbourhood background per epoch, sampled at each building's block
    dy, dx = y[1] - y[0], x[1] - x[0]
    rr = np.clip(np.round((pts[:, 1] - y[0]) / dy).astype(int), 0, H - 1) // bf.HP_BLOCK_PX
    cc = np.clip(np.round((pts[:, 0] - x[0]) / dx).astype(int), 0, W - 1) // bf.HP_BLOCK_PX
    base = np.full((len(b), T), np.nan, np.float32)
    for i in range(T):
        base[:, i] = bf.background_coarse(cum_mm[i], good & valid[i])[rr, cc]

    disp = np.full((len(b), T), np.nan, np.float32)
    n_px = np.zeros(len(b), np.int16)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        for j, (n50, n100) in enumerate(zip(nb50, nb100)):
            u = np.asarray(n50 if n50 else n100, dtype=int)
            if not u.size:
                continue
            r_, c_ = gy[u], gx[u]
            vals = np.where(valid[:, r_, c_], cum_mm[:, r_, c_], np.nan)
            disp[j] = np.nanmedian(vals, axis=1)
            n_px[j] = u.size

    # Prepend the first reference date as the zero epoch
    ref0 = pd.Timestamp(man["reference_datetime"].iloc[0]).tz_localize(None)
    dates = [ref0] + [pd.Timestamp(s).tz_localize(None) for s in man["secondary_datetime"]]
    disp = np.concatenate([np.where(n_px[:, None] > 0, 0.0, np.nan).astype(np.float32), disp], axis=1)
    base = np.concatenate([np.zeros((len(b), 1), np.float32), base], axis=1)
    t = np.array([(d - ref0).days / 365.25 for d in dates])

    bperp = None
    bp_path = args.stack_dir / "bperp.csv"
    if bp_path.exists():
        bp = pd.read_csv(bp_path).set_index("granule")["bperp_m"]
        vals = man["granule"].map(bp).to_numpy(np.float32)
        if np.isfinite(vals).all():
            chained, _ = bf.rebase_chain(vals[:, None].copy(), man)
            bperp = np.concatenate([[0.0], chained[:, 0].astype(np.float64)])
    vel_hp = np.array([fit_velocity(t, (disp[j] - base[j]).astype(np.float64), bperp) for j in range(len(b))],
                      np.float32)

    keep = n_px > 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, bins=b.loc[keep, "bin"].astype(np.int64).to_numpy(),
                        dates=np.array([d.date().isoformat() for d in dates]),
                        disp=disp[keep], base=base[keep], vel_hp=vel_hp[keep], n_px=n_px[keep])
    meta = {
        "measurement": "Line-of-sight (LOS) displacement",
        "units": "mm",
        "source": "NASA OPERA DISP-S1 v1.0, frame F08622 (Sentinel-1 ascending)",
        "posting_m": 30,
        "reference_date": dates[0].date().isoformat(),
        "period_start": dates[0].date().isoformat(),
        "period_end": dates[-1].date().isoformat(),
        "n_epochs": len(dates),
        "relative_to": "median of high-quality pixels across the NYC window, per epoch",
        "building_pixels": "median of good 30 m pixels within 50 m of the footprint centroid (100 m fallback)",
        "baseline_label": "Neighbourhood (~2 km)",
        "velocity_definition": "building minus neighbourhood, linear + annual fit over the full period (mm/yr)",
        "sign": "positive = toward the satellite (≈ uplift); negative = away (≈ subsidence)",
        "note": "Context only: block-scale ground/structure motion. Not a model input and not structural-safety evidence.",
        "chaining_issues": issues,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    args.out.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    v = vel_hp[keep]
    log.info("Wrote %s: %d BINs x %d epochs (%.1f MB); vel_hp p5/p50/p95 = %s", args.out, keep.sum(), len(dates),
             args.out.stat().st_size / 1e6, np.round(np.nanpercentile(v, [5, 50, 95]), 2))


if __name__ == "__main__":
    main()
