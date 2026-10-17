"""Turn remote-subset DISP-S1 granules into per-BIN pre-cutoff InSAR features.

Pipeline (all pre-cutoff: only granules whose secondary date < --cutoff are read):
  1. displacement - solid_earth_tide          (same correction opera-utils reformat applies)
  2. rebase the moving reference dates         (opera_utils rebase_timeseries, checked crossovers)
  3. re-reference every epoch to the median of high-quality pixels in the window
     (removes the frame reference point, regional GIA and common-mode atmosphere)
  4. per-pixel weighted least squares, weights = recommended_mask & finite:
       linear  : a + v t + annual sin/cos                -> velocity, seasonal amp, residual RMS
       quadratic: a + v t + acc t^2/2 + annual sin/cos  -> acceleration
  5. sample at FISP building centroids (KD-tree over 30 m pixel centres)

Sign: DISP-S1 positive LOS = motion toward the satellite (uplift for vertical motion);
negative = away (subsidence). Units in the output: mm and mm/yr.

Usage:
  ml/insar/.venv/bin/python ml/insar/build_features.py \
      --stack-dir data/insar/F08622_nyc --cutoff 2020-02-21
"""

from __future__ import annotations

import argparse
import json
import logging
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
import xarray as xr
from opera_utils.disp._rebase import rebase_timeseries
from pyproj import Transformer
from scipy.spatial import cKDTree

log = logging.getLogger("build_features")
REPO = Path(__file__).resolve().parents[2]

# Pixel-quality thresholds (documented in README / quality report).
MIN_VALID_FRAC = 0.7       # pixel must be recommended & finite in >= 70% of epochs
MIN_MEAN_TCOH = 0.5        # mean temporal coherence for a "good" pixel
REF_VALID_FRAC = 0.95      # stricter set used for the per-epoch spatial reference
REF_MEAN_TCOH = 0.7
R_BUILDING_M = 50.0        # pixels attributed to a building (≈ 9 pixels of 30 m)
R_BUILDING_FALLBACK_M = 100.0
R_LOCAL_M = 200.0          # neighbourhood for local differential motion
HP_BLOCK_PX = 10           # high-pass: 300 m block medians ...
HP_WIN_BLOCKS = 7          # ... then a 7x7-block (2.1 km) moving median as the background
TILE = 200_000             # pixels per least-squares tile

# Published reference rates (Buzzanga et al. 2023, Sci. Adv. 9, eadi8259; vertical, mm/yr,
# 2016-2023, GNSS-tied). Each site is sampled as good pixels within `buffer` metres of its
# points or line segments. LGA runway ends: FAA data via SkyVector (Aug 2026 cycle).
SANITY_SITES = {
    "LaGuardia runways 4-22 & 13-31": {
        "lines": [((-73.884167, 40.769167), (-73.870667, 40.785500)),
                  ((-73.878500, 40.782333), (-73.857167, 40.772000))],
        "buffer": 30.0, "published": -3.7},
    "Arthur Ashe Stadium": {"lines": [((-73.8467, 40.7498),)], "buffer": 120.0, "published": -4.6},
    # Landside comparison, no published rate: the airport reference point (terminal area)
    "LaGuardia landside (airport ref. point)": {
        "lines": [((-73.872667, 40.777167),)], "buffer": 300.0, "published": None},
}
NYC_MEAN_VERT = -1.6


def load_stack(stack_dir: Path, cutoff: pd.Timestamp):
    man = pd.read_csv(stack_dir / "manifest.csv",
                      parse_dates=["reference_datetime", "secondary_datetime"])
    man = man[man["status"].isin(["ok", "exists"])]
    man = man[man["secondary_datetime"].dt.tz_localize(None) < cutoff].sort_values(
        "secondary_datetime").reset_index(drop=True)
    if man.empty:
        raise SystemExit("No usable granules before the cutoff")

    # Two products can share a secondary date (overlapping ministacks); keep the one
    # whose reference is oldest so the chain below has the fewest hops.
    man = man.sort_values(["secondary_datetime", "reference_datetime"]).drop_duplicates(
        "secondary_datetime", keep="first").reset_index(drop=True)

    T = len(man)
    disp = rec = None
    sums = {}
    for i, g in enumerate(man["granule"]):
        path = stack_dir / "granules" / g
        with xr.open_dataset(path, engine="h5netcdf") as ds, \
             xr.open_dataset(path, engine="h5netcdf", group="corrections") as dc:
            d = ds["displacement"].values.squeeze().astype(np.float32)
            if "solid_earth_tide" in dc:
                d -= dc["solid_earth_tide"].values.squeeze().astype(np.float32)
            if disp is None:
                disp = np.empty((T, *d.shape), np.float32)
                rec = np.empty((T, *d.shape), bool)
                # DISP-S1 water_mask: 1 = land, 0 = water
                land = ds["water_mask"].values.squeeze() == 1
                x, y = ds["x"].values, ds["y"].values
                attrs = {k: str(v) for k, v in ds["displacement"].attrs.items()}
                attrs |= {k: str(v) for k, v in ds.attrs.items() if k.startswith("reference_point")}
                for k in ("tcoh", "psim", "ps", "n_tcoh", "n_psim"):
                    sums[k] = np.zeros(d.shape, np.float64)
            disp[i] = d
            rec[i] = ds["recommended_mask"].values.squeeze() == 1
            for key, var in (("tcoh", "temporal_coherence"), ("psim", "phase_similarity")):
                v = ds[var].values.squeeze().astype(np.float64)
                f = np.isfinite(v)
                sums[key] += np.where(f, v, 0.0)
                sums["n_" + key] += f
            sums["ps"] += ds["persistent_scatterer_mask"].values.squeeze() == 1
    with np.errstate(invalid="ignore", divide="ignore"):
        stats = {
            "mean_tcoh": (sums["tcoh"] / sums["n_tcoh"]).astype(np.float32),
            "mean_psim": (sums["psim"] / sums["n_psim"]).astype(np.float32),
            "ps_frac": (sums["ps"] / T).astype(np.float32),
        }
    return man, disp, rec, land, x, y, attrs, stats


def rebase_chain(disp: np.ndarray, man: pd.DataFrame) -> tuple[np.ndarray, list[str]]:
    """Chain moving reference dates by explicit date matching (in place on `disp`).

    cumulative(sec) = offset[ref] + disp(ref -> sec), offset[first ref] = 0, and when a
    new reference R appears, offset[R] = cumulative(R) taken from the product whose
    secondary date is exactly R. Same result as opera_utils rebase_timeseries when the
    crossover product immediately precedes the new ministack, but it fails loudly
    instead of silently chaining across a gap.
    """
    issues = []
    refs = man["reference_datetime"].tolist()
    secs = man["secondary_datetime"].tolist()
    sec_index = {s: i for i, s in enumerate(secs)}
    offset = {refs[0]: np.zeros(disp.shape[1:], np.float32)}
    for i in range(len(man)):
        r = refs[i]
        if r not in offset:
            j = sec_index.get(r)
            if j is None or j >= i or refs[j] not in offset:
                issues.append(f"no crossover product ending on reference {r.date()}; "
                              f"dropping products after it")
                return disp[:i], issues
            offset[r] = disp[j].copy()  # disp[j] already holds cumulative values
        disp[i] += offset[r]
    return disp, issues


def background_coarse(img: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Robust ~2 km background on the block grid: 300 m block medians of masked pixels, then a
    2.1 km (7x7-block) moving median. Pixel (r, c) maps to block (r // HP_BLOCK_PX, c // HP_BLOCK_PX)."""
    from numpy.lib.stride_tricks import sliding_window_view

    H, W = img.shape
    b, k = HP_BLOCK_PX, HP_WIN_BLOCKS
    Hb, Wb = -(-H // b), -(-W // b)
    v = np.full((Hb * b, Wb * b), np.nan, np.float32)
    v[:H, :W] = np.where(mask, img, np.nan)
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        coarse = np.nanmedian(v.reshape(Hb, b, Wb, b).transpose(0, 2, 1, 3).reshape(Hb, Wb, -1), axis=-1)
        cp = np.pad(coarse, k // 2, constant_values=np.nan)
        return np.nanmedian(sliding_window_view(cp, (k, k)).reshape(Hb, Wb, -1), axis=-1).astype(np.float32)


def highpass_velocity(vel: np.ndarray, good: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Velocity minus its ~2 km robust background (`background_coarse`).

    Removes long-wavelength artefacts (residual troposphere/ionosphere ramps, which here
    reach several mm/yr across the 45 km window and would otherwise act as a borough
    proxy) while keeping fill/landfill-scale signals such as runways or stadium bowls.
    """
    H, W = vel.shape
    bg = background_coarse(vel, good)
    bg_px = bg[np.arange(H) // HP_BLOCK_PX][:, np.arange(W) // HP_BLOCK_PX]
    return (vel - bg_px).astype(np.float32), bg_px


def wls_fit(t: np.ndarray, d: np.ndarray, w: np.ndarray, quadratic: bool,
            extra: np.ndarray | None = None):
    """Per-pixel weighted least squares, t:(T,), d,w:(T,P).

    Columns: 1, t, [t^2/2], sin(2πt), cos(2πt), [extra]. Returns params (P,k), residual
    sigma (P,), and the formal variances of the velocity and acceleration terms.
    """
    cols = [np.ones_like(t), t]
    if quadratic:
        cols.append(0.5 * t**2)
    cols += [np.sin(2 * np.pi * t), np.cos(2 * np.pi * t)]
    if extra is not None:
        cols.append(extra - extra.mean())
    G = np.stack(cols, axis=1)  # (T,k)
    k = G.shape[1]
    P = d.shape[1]
    params = np.full((P, k), np.nan, np.float64)
    sigma = np.full(P, np.nan)
    var_v = np.full(P, np.nan)
    var_a = np.full(P, np.nan)
    for s in range(0, P, TILE):
        sl = slice(s, min(P, s + TILE))
        W = w[:, sl].astype(np.float64)
        D = np.where(W > 0, d[:, sl], 0.0).astype(np.float64)
        N = np.einsum("tp,ti,tj->pij", W, G, G, optimize=True)
        b = np.einsum("tp,ti,tp->pi", W, G, D, optimize=True)
        n = W.sum(0)
        ok = n >= k + 3
        if not ok.any():
            continue
        ok[ok] = np.linalg.cond(N[ok]) < 1e8
        if not ok.any():
            continue
        Ninv = np.linalg.inv(N[ok])
        m = np.einsum("pij,pj->pi", Ninv, b[ok])
        idx = np.arange(sl.start, sl.stop)[ok]
        params[idx] = m
        pred = G @ m.T  # (T, Pok)
        res = (D[:, ok] - pred) * W[:, ok]
        dof = n[ok] - k
        s2 = (res**2).sum(0) / dof
        sigma[idx] = np.sqrt(s2)
        var_v[idx] = s2 * Ninv[:, 1, 1]
        if quadratic:
            var_a[idx] = s2 * Ninv[:, 2, 2]
    return params, sigma, var_v, var_a


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--stack-dir", type=Path, required=True)
    ap.add_argument("--buildings", type=Path, default=REPO / "data/insar/ref/fisp_buildings.csv.gz")
    ap.add_argument("--cutoff", type=pd.Timestamp, default=pd.Timestamp("2020-02-21"))
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--report-json", type=Path, default=None)
    ap.add_argument("--pixel-out", type=Path, default=None,
                    help="optional .nc with per-pixel velocity/quality rasters (for maps)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cut = args.cutoff.strftime("%Y-%m-%d")
    out = args.out or REPO / f"data/insar/insar_features_cutoff_{cut}.csv.gz"
    report_json = args.report_json or args.stack_dir / f"quality_cutoff_{cut}.json"
    pixel_out = args.pixel_out or args.stack_dir / f"pixel_velocity_cutoff_{cut}.nc"

    man, cum_mm, rec, land, x, y, attrs, stats = load_stack(args.stack_dir, args.cutoff)
    T, H, W = cum_mm.shape
    log.info("Stack: %d epochs (%s -> %s), window %d x %d px",
             T, man["secondary_datetime"].min().date(), man["secondary_datetime"].max().date(), H, W)
    log.info("displacement attrs: %s", {k: attrs[k] for k in attrs if k in ("units", "description")})

    # Cross-check the chaining against opera-utils on a pixel sample before chaining in place.
    rng = np.random.default_rng(0)
    sample = (rng.integers(0, H, 2000), rng.integers(0, W, 2000))
    ref_dates = [pd.Timestamp(r).tz_localize(None) for r in man["reference_datetime"]]
    ou = rebase_timeseries(cum_mm[:, sample[0], sample[1]][:, :, None], ref_dates)[:, :, 0]
    cum_mm, issues = rebase_chain(cum_mm, man)  # metres, relative to the first reference date
    for msg in issues:
        log.warning(msg)
    if len(cum_mm) < T:
        T = len(cum_mm)
        man, rec = man.iloc[:T], rec[:T]
    rebase_maxdiff = float(np.nanmax(np.abs(cum_mm[:, sample[0], sample[1]] - ou[:T]))) if T else np.nan
    log.info("Rebase vs opera_utils.rebase_timeseries: max |diff| = %.2e m", rebase_maxdiff)
    cum_mm *= 1000.0

    finite = np.isfinite(cum_mm)
    valid = finite & rec & land[None]
    valid_frac = valid.mean(0)
    mean_tcoh = stats["mean_tcoh"]
    ps_frac = stats["ps_frac"]
    good = land & (valid_frac >= MIN_VALID_FRAC) & (mean_tcoh >= MIN_MEAN_TCOH)
    ref_px = land & (valid_frac >= REF_VALID_FRAC) & (mean_tcoh >= REF_MEAN_TCOH)
    if ref_px.sum() < 500:
        log.warning("Only %d strict reference pixels; falling back to 'good' pixels", ref_px.sum())
        ref_px = good
    log.info("Land px %d | good px %d (%.1f%% of land) | reference px %d",
             land.sum(), good.sum(), 100 * good.sum() / max(1, land.sum()), ref_px.sum())

    # Per-epoch spatial reference: median of reference pixels' cumulative displacement.
    ref_series = np.array([np.median(cum_mm[i][valid[i] & ref_px]) for i in range(T)])
    cum_mm -= ref_series[:, None, None]

    # Time axis: years since first reference date, which is a zero-displacement epoch.
    t0 = ref_dates[0]
    t_sec = np.array([(pd.Timestamp(s).tz_localize(None) - t0).days / 365.25 for s in man["secondary_datetime"]])
    t_all = np.concatenate([[0.0], t_sec])
    tc = t_all - t_all.mean()  # centre so acceleration does not trade off with intercept

    # Perpendicular baseline per epoch (fetch_bperp.py), chained like the displacement so
    # it is relative to the first reference acquisition. Fitting it absorbs residual DEM
    # (scatterer-height) error, which is large for high-rise roofs.
    bperp_cum = None
    bp_path = args.stack_dir / "bperp.csv"
    if bp_path.exists():
        bp = pd.read_csv(bp_path).set_index("granule")["bperp_m"]
        vals = man["granule"].map(bp).to_numpy(np.float32)
        if np.isfinite(vals).all():
            chained, _ = rebase_chain(vals[:, None].copy(), man)
            bperp_cum = np.concatenate([[0.0], chained[:, 0].astype(np.float64)])
            log.info("B_perp (chained) range %.0f .. %.0f m", bperp_cum.min(), bperp_cum.max())
        else:
            log.warning("bperp.csv incomplete; fitting without the DEM-error term")

    idx = np.flatnonzero(good.ravel())
    D = np.concatenate([np.zeros((1, idx.size), np.float32), cum_mm.reshape(T, -1)[:, idx]])
    Wt = np.concatenate([np.ones((1, idx.size), bool), valid.reshape(T, -1)[:, idx]])
    lin, sig_lin, var_v, _ = wls_fit(tc, D, Wt, quadratic=False, extra=bperp_cum)
    quad, _, _, var_a = wls_fit(tc, D, Wt, quadratic=True, extra=bperp_cum)

    def to_img(vals):
        img = np.full(H * W, np.nan, np.float32)
        img[idx] = vals
        return img.reshape(H, W)

    vel = to_img(lin[:, 1])
    vel_se = to_img(np.sqrt(var_v))
    seas = to_img(np.hypot(lin[:, 2], lin[:, 3]))
    rms = to_img(sig_lin)
    acc = to_img(quad[:, 2])
    acc_se = to_img(np.sqrt(var_a))

    # LOS -> vertical (assumes purely vertical motion): v_up = v_los / los_up
    los_up = np.full((H, W), np.nan, np.float32)
    lay = np.zeros((H, W), np.uint8)
    xx, yy = np.meshgrid(x, y)
    for name, target in [("static_los_enu.tif", "los"), ("static_layover_shadow_mask.tif", "lay")]:
        p = args.stack_dir / name
        if not p.exists():
            continue
        with rasterio.open(p) as src:
            band = 3 if target == "los" else 1
            rr, cc = rasterio.transform.rowcol(src.transform, xx.ravel(), yy.ravel())
            rr, cc = np.asarray(rr), np.asarray(cc)
            inb = (rr >= 0) & (rr < src.height) & (cc >= 0) & (cc < src.width)
            data = src.read(band)
            vals = np.full(rr.size, np.nan if target == "los" else 0, np.float32)
            vals[inb] = data[rr[inb], cc[inb]]
            if target == "los":
                vals[(vals <= 0) | (vals > 1)] = np.nan
                los_up = vals.reshape(H, W)
            else:
                lay = vals.reshape(H, W).astype(np.uint8)
    if np.isfinite(los_up).any():
        log.info("LOS up component: median %.3f (incidence ≈ %.1f°)", np.nanmedian(los_up),
                 np.degrees(np.arccos(np.nanmedian(los_up))))
    vel_vert = vel / los_up
    vel_hp, vel_bg = highpass_velocity(vel, good)
    # Long-wavelength ramp diagnostic: plane fit to the velocity of good pixels (km units)
    gyy, gxx = np.nonzero(good)
    sel = np.random.default_rng(1).choice(gyy.size, min(200_000, gyy.size), replace=False)
    A = np.c_[np.ones(sel.size), (x[gxx[sel]] - x.mean()) / 1e3, (y[gyy[sel]] - y.mean()) / 1e3]
    plane, *_ = np.linalg.lstsq(A, vel[gyy[sel], gxx[sel]].astype(np.float64), rcond=None)
    ramp = {"east_mm_yr_per_10km": round(float(plane[1] * 10), 3),
            "north_mm_yr_per_10km": round(float(plane[2] * 10), 3),
            "across_window_mm_yr": round(float(np.hypot(plane[1], plane[2]) * np.hypot(
                np.ptp(x), np.ptp(y)) / 1e3), 2)}
    log.info("Long-wavelength velocity ramp: %s", ramp)

    # DEM error: LOS = B_perp * dh / (R sin θ); coefficient is mm per metre of baseline.
    dem_err = np.full((H, W), np.nan, np.float32)
    if bperp_cum is not None:
        cos_t = np.where(np.isfinite(los_up), los_up, np.nanmedian(los_up))
        slant_range = 693e3 / cos_t  # Sentinel-1 altitude, flat-Earth approximation
        dem_err = to_img(lin[:, -1]) * 1e-3 * slant_range * np.sqrt(1 - cos_t**2)

    xr.Dataset(
        {k: (("y", "x"), v) for k, v in dict(
            velocity_los_mm_yr=vel, velocity_vert_mm_yr=vel_vert, velocity_se_mm_yr=vel_se,
            velocity_hp2km_los_mm_yr=vel_hp, velocity_background_los_mm_yr=vel_bg,
            acceleration_los_mm_yr2=acc, acceleration_se_mm_yr2=acc_se, seasonal_amp_mm=seas, residual_rms_mm=rms,
            dem_error_m=dem_err,
            valid_frac=valid_frac.astype(np.float32), mean_temporal_coherence=mean_tcoh,
            ps_frac=ps_frac.astype(np.float32), good=good.astype(np.uint8),
            land=land.astype(np.uint8), los_up=los_up, layover_shadow=lay).items()},
        coords={"x": x, "y": y},
        attrs={"crs": "EPSG:32618", "cutoff": cut, "n_epochs": T,
               "sign": "positive = toward satellite (LOS); vertical assumes no horizontal motion"},
    ).to_netcdf(pixel_out, engine="h5netcdf")

    # ---------------------------------------------------------------- per-building sampling
    b = pd.read_csv(args.buildings)
    has_xy = b["x_utm18n"].notna()
    dx, dy = abs(x[1] - x[0]), abs(y[1] - y[0])
    in_win = has_xy & b["x_utm18n"].between(x.min() - dx / 2, x.max() + dx / 2) \
        & b["y_utm18n"].between(y.min() - dy / 2, y.max() + dy / 2)
    gy, gx = np.nonzero(good)
    tree_good = cKDTree(np.c_[x[gx], y[gy]])
    ly, lx = np.nonzero(land)
    tree_land = cKDTree(np.c_[x[lx], y[ly]])
    g_vel = vel[gy, gx]
    g_vert = vel_vert[gy, gx]
    g = {
        "vel": g_vel, "vert": g_vert, "se": vel_se[gy, gx], "acc": acc[gy, gx], "acc_se": acc_se[gy, gx], "dem": dem_err[gy, gx], "hp": vel_hp[gy, gx],
        "seas": seas[gy, gx], "rms": rms[gy, gx], "tcoh": mean_tcoh[gy, gx], "ps": ps_frac[gy, gx],
    }
    pts = b.loc[in_win, ["x_utm18n", "y_utm18n"]].to_numpy()
    nb50 = tree_good.query_ball_point(pts, R_BUILDING_M)
    nb100 = tree_good.query_ball_point(pts, R_BUILDING_FALLBACK_M)
    nb200 = tree_good.query_ball_point(pts, R_LOCAL_M)
    nland50 = tree_land.query_ball_point(pts, R_BUILDING_M, return_length=True)
    dist_good, _ = tree_good.query(pts, k=1)

    rows = []
    for i, (n50, n100, n200) in enumerate(zip(nb50, nb100, nb200)):
        use = n50 if len(n50) else n100
        r = {"insar_n_px_50m": len(n50), "insar_n_px_100m": len(n100), "insar_n_px_200m": len(n200),
             "insar_land_px_50m": int(nland50[i]), "insar_dist_good_px_m": float(dist_good[i]),
             "insar_radius_used_m": R_BUILDING_M if len(n50) else (R_BUILDING_FALLBACK_M if len(n100) else np.nan)}
        if len(use):
            u = np.asarray(use)
            r.update({
                "insar_vel_los_mm_yr": np.median(g["vel"][u]),
                "insar_vel_hp2km_mm_yr": np.median(g["hp"][u]),
                "insar_vel_vert_mm_yr": np.nanmedian(g["vert"][u]),
                "insar_vel_se_mm_yr": np.median(g["se"][u]),
                "insar_acc_los_mm_yr2": np.median(g["acc"][u]),
                "insar_acc_se_mm_yr2": np.median(g["acc_se"][u]),
                "insar_seasonal_amp_mm": np.median(g["seas"][u]),
                "insar_resid_rms_mm": np.median(g["rms"][u]),
                "insar_dem_err_m": np.median(g["dem"][u]),
                "insar_tcoh_mean": np.mean(g["tcoh"][u]),
                "insar_ps_frac": np.mean(g["ps"][u]),
                "insar_vel_iqr_mm_yr": np.subtract(*np.percentile(g["vel"][u], [75, 25])) if len(u) > 1 else 0.0,
            })
        if len(n200) >= 5:
            r["insar_vel_local_med_200m"] = np.median(g["vel"][np.asarray(n200)])
        rows.append(r)
    feat = pd.DataFrame(rows, index=b.index[in_win])
    feat["insar_vel_diff_local_mm_yr"] = feat.get("insar_vel_los_mm_yr") - feat.get("insar_vel_local_med_200m")
    feat["insar_good_frac_50m"] = feat["insar_n_px_50m"] / feat["insar_land_px_50m"].replace(0, np.nan)

    # Layover/shadow flag at the centroid pixel
    rr = np.clip(np.round((pts[:, 1] - y[0]) / (y[1] - y[0])).astype(int), 0, H - 1)
    cc = np.clip(np.round((pts[:, 0] - x[0]) / (x[1] - x[0])).astype(int), 0, W - 1)
    feat["insar_layover_shadow"] = lay[rr, cc]

    outdf = b[["bin", "bbl", "borough", "lon", "lat", "loc_source"]].join(feat)
    outdf["insar_in_window"] = in_win.astype(int)
    outdf["insar_has_data"] = outdf["insar_vel_los_mm_yr"].notna().astype(int)
    outdf["insar_cutoff"] = cut
    outdf["insar_n_epochs"] = T
    out.parent.mkdir(parents=True, exist_ok=True)
    outdf.to_csv(out, index=False, float_format="%.4f")
    log.info("Wrote %s: %d BINs, %d in window, %d with data", out, len(outdf), int(in_win.sum()),
             int(outdf["insar_has_data"].sum()))

    # ---------------------------------------------------------------- quality summary
    def pct(a, q=(1, 5, 25, 50, 75, 95, 99)):
        a = a[np.isfinite(a)]
        return {f"p{k}": round(float(np.percentile(a, k)), 3) for k in q} | {
            "mean": round(float(a.mean()), 3), "std": round(float(a.std()), 3), "n": int(a.size)}

    sanity = {}
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32618", always_xy=True)
    for name, site in SANITY_SITES.items():
        pts_s = []
        for seg in site["lines"]:
            xy = np.array([to_utm.transform(lo, la) for lo, la in seg])
            if len(xy) == 1:
                pts_s.append(xy)
                continue
            for a, c in zip(xy[:-1], xy[1:]):  # densify every 15 m along the segment
                k = max(2, int(np.hypot(*(c - a)) / 15) + 1)
                pts_s.append(a + np.linspace(0, 1, k)[:, None] * (c - a))
        pts_s = np.vstack(pts_s)
        X, Y = pts_s.mean(0)
        if not (x.min() <= X <= x.max() and y.min() <= Y <= y.max()):
            sanity[name] = {"in_window": False}
            continue
        n = sorted({j for lst in tree_good.query_ball_point(pts_s, site["buffer"]) for j in lst})
        nloc = tree_good.query_ball_point([X, Y], 2000.0)
        v = np.median(g_vel[n]) if n else np.nan
        vv = np.nanmedian(g_vert[n]) if n else np.nan
        locv = np.nanmedian(g_vert[nloc]) if nloc else np.nan
        pub = site["published"]
        sanity[name] = {
            "in_window": True, "buffer_m": site["buffer"], "n_good_px": len(n),
            "vel_los_mm_yr": round(float(v), 2), "vel_vert_mm_yr": round(float(vv), 2),
            "local_2km_median_vert_mm_yr": round(float(locv), 2),
            "relative_to_2km_vert_mm_yr": round(float(vv - locv), 2),
            "published_vert_mm_yr": pub,
            "published_relative_to_nyc_mean_mm_yr": None if pub is None else round(pub - NYC_MEAN_VERT, 2),
        }
        if n:
            n = np.asarray(n)
            sub = np.where(valid[:, gy[n], gx[n]], cum_mm[:, gy[n], gx[n]], np.nan)
            with np.errstate(all="ignore"):
                series = np.nanmedian(sub, axis=1) / np.nanmedian(los_up[gy[n], gx[n]])
            sanity[name]["series_dates"] = [str(pd.Timestamp(d).date()) for d in man["secondary_datetime"]]
            sanity[name]["series_vert_mm"] = [None if not np.isfinite(v) else round(float(v), 2) for v in series]
            # Same, minus the 2 km neighbourhood median series: cancels shared atmosphere
            nl = np.asarray(nloc)
            loc_sub = np.where(valid[:, gy[nl], gx[nl]], cum_mm[:, gy[nl], gx[nl]], np.nan)
            with np.errstate(all="ignore"):
                rel = series - np.nanmedian(loc_sub, axis=1) / np.nanmedian(los_up[gy[nl], gx[nl]])
            sanity[name]["series_rel_2km_vert_mm"] = [None if not np.isfinite(v) else round(float(v), 2)
                                                      for v in rel]

    bw = outdf[outdf["insar_in_window"] == 1]
    report = {
        "cutoff": cut, "n_epochs": T,
        "first_secondary": str(man["secondary_datetime"].min().date()),
        "last_secondary": str(man["secondary_datetime"].max().date()),
        "reference_dates": sorted({str(pd.Timestamp(r).date()) for r in man["reference_datetime"]}),
        "crossover_issues": issues, "rebase_vs_opera_utils_max_abs_diff_m": rebase_maxdiff,
        "mean_phase_similarity_land": round(float(np.nanmean(np.where(land, stats["mean_psim"], np.nan))), 4),
        "window_px": [H, W], "land_px": int(land.sum()), "good_px": int(good.sum()),
        "good_frac_of_land": round(float(good.sum() / max(1, land.sum())), 4),
        "reference_px": int(ref_px.sum()),
        "mean_recommended_frac_land": round(float(np.nanmean(np.where(land, rec.mean(0), np.nan))), 4),
        "mean_temporal_coherence_land": round(float(np.nanmean(np.where(land, mean_tcoh, np.nan))), 4),
        "ps_frac_land": round(float(np.nanmean(np.where(land, ps_frac, np.nan))), 4),
        "los_up_median": round(float(np.nanmedian(los_up)), 4) if np.isfinite(los_up).any() else None,
        "pixel_velocity_los_mm_yr": pct(vel[good]),
        "pixel_velocity_vert_mm_yr": pct(vel_vert[good]),
        "pixel_velocity_se_mm_yr": pct(vel_se[good]),
        "pixel_acceleration_mm_yr2": pct(acc[good]),
        "pixel_residual_rms_mm": pct(rms[good]),
        "pixel_seasonal_amp_mm": pct(seas[good]),
        "dem_error_term_fitted": bperp_cum is not None,
        "pixel_dem_error_m": pct(dem_err[good]) if bperp_cum is not None else None,
        "reference_series_mm": {"min": round(float(np.nanmin(ref_series)), 2),
                                "max": round(float(np.nanmax(ref_series)), 2)},
        "buildings_total": int(len(outdf)), "buildings_located": int(has_xy.sum()),
        "buildings_in_window": int(in_win.sum()),
        "buildings_with_data": int(outdf["insar_has_data"].sum()),
        "coverage_of_fisp_universe": round(float(outdf["insar_has_data"].mean()), 4),
        "coverage_of_in_window": round(float(bw["insar_has_data"].mean()), 4) if len(bw) else None,
        "coverage_by_borough": outdf.groupby("borough")["insar_has_data"].mean().round(4).to_dict(),
        "building_velocity_los_mm_yr": pct(outdf["insar_vel_los_mm_yr"].to_numpy(float)),
        "building_velocity_hp2km_mm_yr": pct(outdf["insar_vel_hp2km_mm_yr"].to_numpy(float)),
        "building_velocity_median_by_borough": outdf.groupby("borough")[
            ["insar_vel_los_mm_yr", "insar_vel_hp2km_mm_yr"]].median().round(3).to_dict(orient="index"),
        "velocity_ramp": ramp,
        "pixel_velocity_hp2km_mm_yr": pct(vel_hp[good]),
        "building_vel_diff_local_mm_yr": pct(outdf["insar_vel_diff_local_mm_yr"].to_numpy(float)),
        "building_n_px_50m": pct(outdf["insar_n_px_50m"].to_numpy(float)),
        "building_layover_shadow_frac": round(float(bw["insar_layover_shadow"].gt(0).mean()), 4) if len(bw) else None,
        "sanity_sites": sanity,
        "reference_series_dates": [str(pd.Timestamp(d).date()) for d in man["secondary_datetime"]],
        "reference_series_values_mm": [round(float(v), 2) for v in ref_series],
        "thresholds": {"MIN_VALID_FRAC": MIN_VALID_FRAC, "MIN_MEAN_TCOH": MIN_MEAN_TCOH,
                       "REF_VALID_FRAC": REF_VALID_FRAC, "REF_MEAN_TCOH": REF_MEAN_TCOH,
                       "R_BUILDING_M": R_BUILDING_M, "R_LOCAL_M": R_LOCAL_M},
        "displacement_attrs": attrs,
    }
    report_json.write_text(json.dumps(report, indent=2, default=str))
    log.info("Wrote %s", report_json)
    brief = {k: report[k] for k in ("good_frac_of_land", "coverage_of_fisp_universe",
                                    "pixel_velocity_los_mm_yr", "building_velocity_los_mm_yr")}
    brief["sanity_sites"] = {n: {k: v for k, v in s.items() if not k.startswith("series")}
                             for n, s in sanity.items()}
    print(json.dumps(brief, indent=2))


if __name__ == "__main__":
    main()
