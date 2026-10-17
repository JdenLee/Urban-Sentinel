"""Render the InSAR quality report (markdown + figures) from build_features.py outputs.

Usage:
  ml/insar/.venv/bin/python ml/insar/quality_report.py \
      --stack-dir data/insar/F08622_nyc --cutoff 2020-02-21
Writes ml/insar/QUALITY_REPORT.md and ml/insar/figures/*.png, and a <=20-row
ml/insar/sample_features.txt (*.csv is gitignored in this repo).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import xarray as xr  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402
from pyproj import Transformer  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

# Chart tokens (dataviz reference palette, light mode)
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
AXIS = "#c3c2b7"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a"]  # categorical slots 1-3 (blue, orange, aqua)
NODATA = "#e1e0d9"
# Diverging blue <-> red, neutral gray midpoint, 3 steps per arm. Blue arm = blue ramp
# 600/400/200; red arm mirrors it around the red categorical slot #e34948.
DIVERGING = LinearSegmentedColormap.from_list(
    "bu_gy_rd",
    ["#184f95", "#3987e5", "#9ec5f4", "#f0efec", "#f3a9a8", "#e34948", "#9e2423"],
)


def style(ax) -> None:
    ax.set_facecolor(SURFACE)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(AXIS)
    ax.tick_params(colors=MUTED, labelsize=8)
    ax.grid(axis="y", color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)


def velocity_map(px: xr.Dataset, rep: dict, out: Path) -> None:
    x, y = px["x"].values, px["y"].values
    ext = [x.min() / 1e3, x.max() / 1e3, y.min() / 1e3, y.max() / 1e3]
    lim = 4.0
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32618", always_xy=True)
    panels = [("velocity_los_mm_yr", "As measured (relative to window median)"),
              ("velocity_hp2km_los_mm_yr", "Minus ~2 km background (feature insar_vel_hp2km)")]
    fig, axes = plt.subplots(1, 2, figsize=(13, 6.6), facecolor=SURFACE)
    for ax, (var, title) in zip(axes, panels):
        ax.set_facecolor(NODATA)
        im = ax.imshow(np.ma.masked_invalid(px[var].values), cmap=DIVERGING, vmin=-lim, vmax=lim,
                       extent=ext, origin="upper" if y[0] > y[-1] else "lower", interpolation="nearest")
        for lon, lat, label in [(-73.8708, 40.7775, "LaGuardia"), (-73.8467, 40.7498, "Arthur Ashe")]:
            X, Y = to_utm.transform(lon, lat)
            ax.plot(X / 1e3, Y / 1e3, marker="o", ms=14, mfc="none", mec=INK, mew=1.2)
            ax.annotate(label, (X / 1e3, Y / 1e3), xytext=(10, 8), textcoords="offset points",
                        fontsize=8, color=INK)
        for side in ax.spines.values():
            side.set_visible(False)
        ax.tick_params(colors=MUTED, labelsize=8)
        ax.set_xlabel("UTM 18N easting (km)", color=INK2, fontsize=9)
        ax.set_title(title, loc="left", fontsize=10, color=INK)
    axes[0].set_ylabel("UTM 18N northing (km)", color=INK2, fontsize=9)
    fig.suptitle(f"LOS velocity, {rep['first_secondary']} to {rep['last_secondary']} (mm/yr); "
                 "gray = water or masked", x=0.01, ha="left", fontsize=11, color=INK)
    cb = fig.colorbar(im, ax=axes, fraction=0.02, pad=0.01, extend="both")
    cb.outline.set_visible(False)
    cb.ax.tick_params(colors=MUTED, labelsize=8)
    cb.set_label("away from satellite  ←  mm/yr  →  toward", color=INK2, fontsize=8)
    fig.savefig(out, dpi=100, facecolor=SURFACE, bbox_inches="tight")
    plt.close(fig)


def distributions(feat: pd.DataFrame, out: Path) -> None:
    panels = [
        ("Building LOS velocity, as measured", feat["insar_vel_los_mm_yr"].dropna().values, "mm/yr"),
        ("Building LOS velocity, ~2 km high-pass", feat["insar_vel_hp2km_mm_yr"].dropna().values, "mm/yr"),
        ("Building velocity minus 200 m median", feat["insar_vel_diff_local_mm_yr"].dropna().values, "mm/yr"),
        ("Velocity standard error (formal)", feat["insar_vel_se_mm_yr"].dropna().values, "mm/yr"),
    ]
    fig, axes = plt.subplots(2, 2, figsize=(9, 5.6), facecolor=SURFACE)
    for ax, (title, vals, unit) in zip(axes.ravel(), panels):
        style(ax)
        lo, hi = np.percentile(vals, [0.5, 99.5])
        ax.hist(np.clip(vals, lo, hi), bins=60, color=SERIES[0], edgecolor=SURFACE, linewidth=0.5)
        med = np.median(vals)
        ax.axvline(med, color=INK, linewidth=1)
        ax.annotate(f"median {med:.2f}\nIQR {np.subtract(*np.percentile(vals, [75, 25])):.2f}\nn = {len(vals):,}",
                    xy=(0.98, 0.95), xycoords="axes fraction", ha="right", va="top", fontsize=8, color=INK2)
        ax.set_title(title, loc="left", fontsize=9, color=INK)
        ax.set_xlabel(unit, color=INK2, fontsize=8)
    fig.tight_layout()
    fig.savefig(out, dpi=130, facecolor=SURFACE)
    plt.close(fig)


def site_zoom(px: xr.Dataset, out: Path) -> None:
    """Zoom on LaGuardia + Arthur Ashe with the sampled runway centrelines drawn."""
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32618", always_xy=True)
    cx, cy = to_utm.transform(-73.862, 40.765)
    half = 2600
    sub = px.sel(x=slice(cx - half, cx + half), y=slice(cy + half, cy - half))
    fig, ax = plt.subplots(figsize=(6.4, 6.0), facecolor=SURFACE)
    ax.set_facecolor(NODATA)
    ext = [-half / 1e3, half / 1e3, -half / 1e3, half / 1e3]
    im = ax.imshow(np.ma.masked_invalid(sub["velocity_vert_mm_yr"].values), cmap=DIVERGING,
                   vmin=-5, vmax=5, extent=ext, interpolation="nearest")
    runways = [((-73.884167, 40.769167), (-73.870667, 40.785500)),
               ((-73.878500, 40.782333), (-73.857167, 40.772000))]
    for a, b in runways:
        xs, ys = zip(*(to_utm.transform(*p) for p in (a, b)))
        ax.plot((np.array(xs) - cx) / 1e3, (np.array(ys) - cy) / 1e3, color=INK, lw=1, ls="--")
    for lon, lat, label, off, ha in [(-73.8708, 40.7800, "LGA runways (dashed)", (12, 10), "left"),
                                     (-73.8467, 40.7498, "Arthur Ashe Stadium", (-12, 10), "right")]:
        X, Y = to_utm.transform(lon, lat)
        ax.annotate(label, ((X - cx) / 1e3, (Y - cy) / 1e3), xytext=off, ha=ha,
                    textcoords="offset points", fontsize=8, color=INK)
    X, Y = to_utm.transform(-73.8467, 40.7498)
    ax.plot((X - cx) / 1e3, (Y - cy) / 1e3, marker="o", ms=12, mfc="none", mec=INK, mew=1.2)
    for side in ax.spines.values():
        side.set_visible(False)
    ax.tick_params(colors=MUTED, labelsize=8)
    ax.set_xlabel("km", color=INK2, fontsize=8)
    ax.set_title("Vertical-equivalent velocity near the sanity sites (mm/yr)",
                 loc="left", fontsize=10, color=INK)
    cb = fig.colorbar(im, ax=ax, fraction=0.04, pad=0.02, extend="both")
    cb.outline.set_visible(False)
    cb.ax.tick_params(colors=MUTED, labelsize=8)
    fig.tight_layout()
    fig.savefig(out, dpi=130, facecolor=SURFACE)
    plt.close(fig)


SHORT_NAMES = {"LaGuardia runways 4-22 & 13-31": "LGA runways", "Arthur Ashe Stadium": "Arthur Ashe",
               "LaGuardia landside (airport ref. point)": "LGA landside"}


def site_series(rep: dict, out: Path) -> bool:
    sites = {k: v for k, v in rep["sanity_sites"].items() if v.get("series_rel_2km_vert_mm")}
    if not sites:
        return False
    fig, ax = plt.subplots(figsize=(9.5, 4.0), facecolor=SURFACE)
    style(ax)
    ends = []
    for color, (name, s) in zip(SERIES, sites.items()):
        d = pd.to_datetime(s["series_dates"])
        v = np.array([np.nan if a is None else a for a in s["series_rel_2km_vert_mm"]], float)
        ax.plot(d, v, color=color, linewidth=2, marker="o", ms=3, label=name)
        ok = np.isfinite(v)
        t = (d - d[0]).days.values / 365.25
        slope = np.polyfit(t[ok], v[ok], 1)
        ax.plot(d[ok], np.polyval(slope, t[ok]), color=color, linewidth=1, linestyle="--")
        short = SHORT_NAMES.get(name, name)
        ends.append([np.polyval(slope, t[ok][-1]), f"{short}: {slope[0]:+.1f} mm/yr", color, d[ok][-1]])
    ends.sort(key=lambda e: e[0])
    span = np.subtract(*ax.get_ylim()[::-1])
    for i in range(1, len(ends)):  # keep direct labels >= 6% of the axis apart
        ends[i][0] = max(ends[i][0], ends[i - 1][0] + 0.06 * span)
    for yv, text, color, x_end in ends:
        ax.annotate(text, (x_end, yv), xytext=(8, 0), textcoords="offset points", va="center",
                    fontsize=8, color=INK)
    ax.axhline(0, color=AXIS, linewidth=1)
    ax.set_ylabel("vertical-equivalent mm, site − 2 km median", color=INK2, fontsize=8)
    ax.set_title("Sanity sites relative to their own 2 km neighbourhood (shared atmosphere cancels); "
                 "dashed = linear fit", loc="left", fontsize=10, color=INK)
    ax.legend(frameon=False, fontsize=8, loc="lower left")
    ax.margins(x=0.02)
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.subplots_adjust(right=0.84)
    fig.savefig(out, dpi=130, facecolor=SURFACE)
    plt.close(fig)
    return True


def fmt_pct(d: dict, keys=("p5", "p25", "p50", "p75", "p95")) -> str:
    return " / ".join(f"{d[k]:+.2f}" for k in keys)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--stack-dir", type=Path, required=True)
    ap.add_argument("--cutoff", default="2020-02-21")
    args = ap.parse_args()
    cut = args.cutoff
    rep = json.loads((args.stack_dir / f"quality_cutoff_{cut}.json").read_text())
    px = xr.open_dataset(args.stack_dir / f"pixel_velocity_cutoff_{cut}.nc", engine="h5netcdf")
    feat_path = REPO / f"data/insar/insar_features_cutoff_{cut}.csv.gz"
    feat = pd.read_csv(feat_path)

    figdir = HERE / "figures"
    figdir.mkdir(exist_ok=True)
    velocity_map(px, rep, figdir / "velocity_map.png")
    distributions(feat, figdir / "distributions.png")
    has_series = site_series(rep, figdir / "sanity_sites.png")
    site_zoom(px, figdir / "sanity_zoom.png")

    # <=20-row sample: 3 rows with data per borough, then rows without data (NaN handling)
    sample = feat[feat["insar_has_data"] == 1].groupby("borough").sample(n=3, random_state=0)
    sample = pd.concat([sample, feat[feat["insar_has_data"] == 0].head(20 - len(sample))]).head(20)
    sample.to_csv(HERE / "sample_features.txt", index=False, float_format="%.4f")

    # Signal-vs-noise summary at building level
    bv = feat["insar_vel_los_mm_yr"].dropna()
    bse = feat["insar_vel_se_mm_yr"].dropna()
    snr_frac = float((feat["insar_vel_los_mm_yr"].abs() > 2 * feat["insar_vel_se_mm_yr"]).sum()
                     / max(1, feat["insar_has_data"].sum()))
    sites_md = []
    for name, s in rep["sanity_sites"].items():
        if not s.get("in_window"):
            sites_md.append(f"| {name} | not in window | | | |")
            continue
        pub = s["published_vert_mm_yr"]
        rel = s["published_relative_to_nyc_mean_mm_yr"]
        sites_md.append(
            f"| {name} | {s['vel_vert_mm_yr']:+.2f} ({s['n_good_px']} px, ±{s['buffer_m']:.0f} m) | "
            f"{s['relative_to_2km_vert_mm_yr']:+.2f} | {'n/a' if pub is None else f'{pub:+.1f}'} | "
            f"{'n/a' if rel is None else f'{rel:+.1f}'} |")
    cov_b = " · ".join(f"{k} {v:.1%}" for k, v in rep["coverage_by_borough"].items())
    snr_hp = float((feat["insar_vel_hp2km_mm_yr"].abs() > 2 * feat["insar_vel_se_mm_yr"]).sum()
                   / max(1, feat["insar_has_data"].sum()))
    boro_md = "\n".join(
        f"| {b} | {m['insar_vel_los_mm_yr']:+.2f} | {m['insar_vel_hp2km_mm_yr']:+.2f} |"
        for b, m in rep["building_velocity_median_by_borough"].items())
    ramp = rep["velocity_ramp"]

    # Confound check: do the features mostly encode building height (a likely existing feature)?
    bld = pd.read_csv(REPO / "data/insar/ref/fisp_buildings.csv.gz", usecols=["bin", "height_roof_ft"])
    fh = feat.merge(bld, on="bin", how="left")
    corr_rows = []
    for col in ["insar_vel_los_mm_yr", "insar_vel_hp2km_mm_yr", "insar_vel_diff_local_mm_yr",
                "insar_seasonal_amp_mm", "insar_resid_rms_mm", "insar_dem_err_m", "insar_ps_frac"]:
        if col in fh:
            sub = fh[[col, "height_roof_ft"]].dropna()
            rho = sub[col].rank().corr(sub["height_roof_ft"].rank())
            corr_rows.append(f"| `{col}` | {rho:+.2f} | {len(sub):,} |")
    corr_md = "\n".join(corr_rows)
    pv, bvp = rep["pixel_velocity_los_mm_yr"], rep["building_velocity_los_mm_yr"]
    md = f"""# InSAR quality report: OPERA DISP-S1 F08622, NYC window, cutoff {cut}

Generated by `ml/insar/quality_report.py` from `build_features.py` outputs. All numbers use
only granules whose secondary (later) date is before {cut}.

## Inputs
- Frame F08622 (Sentinel-1 ascending), {rep['n_epochs']} epochs, {rep['first_secondary']} → {rep['last_secondary']}
  (time series starts at reference date {rep['reference_dates'][0]}).
- Reference dates (ministacks): {', '.join(rep['reference_dates'])}.
- Crossover check: {'OK, every new reference date has a product ending on it' if not rep['crossover_issues'] else '; '.join(rep['crossover_issues'])}.
  Explicit date-matched chaining agrees with `opera_utils` `rebase_timeseries` to
  {rep['rebase_vs_opera_utils_max_abs_diff_m']:.1e} m on a 2,000-pixel sample.
- Window: {rep['window_px'][0]} × {rep['window_px'][1]} px of 30 m, {rep['land_px']:,} land pixels.

## Measurement quality
| metric | value |
|---|---|
| land pixels passing quality (recommended ≥ {rep['thresholds']['MIN_VALID_FRAC']:.0%} of epochs, mean temporal coherence ≥ {rep['thresholds']['MIN_MEAN_TCOH']}) | {rep['good_px']:,} ({rep['good_frac_of_land']:.1%} of land) |
| mean fraction of epochs with `recommended_mask` = 1 (land) | {rep['mean_recommended_frac_land']:.1%} |
| mean temporal coherence (land) | {rep['mean_temporal_coherence_land']:.3f} |
| mean phase similarity (land) | {rep['mean_phase_similarity_land']:.3f} |
| persistent-scatterer fraction (land) | {rep['ps_frac_land']:.1%} |
| spatial reference pixels (≥ {rep['thresholds']['REF_VALID_FRAC']:.0%} recommended, coherence ≥ {rep['thresholds']['REF_MEAN_TCOH']}) | {rep['reference_px']:,} |
| LOS up-component (median) | {rep['los_up_median']} (incidence ≈ {np.degrees(np.arccos(rep['los_up_median'])):.1f}°) |
| residual RMS about linear + annual model, median | {rep['pixel_residual_rms_mm']['p50']:.2f} mm |
| formal velocity SE, median (white-noise assumption, optimistic) | {rep['pixel_velocity_se_mm_yr']['p50']:.2f} mm/yr |

## Velocity distribution (LOS, mm/yr, relative to window median)
p5 / p25 / p50 / p75 / p95
- Pixels: {fmt_pct(pv)} (std {pv['std']:.2f}, n = {pv['n']:,})
- FISP buildings: {fmt_pct(bvp)} (std {bvp['std']:.2f}, n = {bvp['n']:,})
- Building minus 200 m neighbourhood median: {fmt_pct(rep['building_vel_diff_local_mm_yr'])}
- FISP buildings, ~2 km high-pass: {fmt_pct(rep['building_velocity_hp2km_mm_yr'])} (std {rep['building_velocity_hp2km_mm_yr']['std']:.2f})
- Buildings where |velocity| > 2 × formal SE: {snr_frac:.1%} as measured, {snr_hp:.1%} after the
  high-pass. The formal SE ignores temporally correlated atmospheric noise, so both overstate
  significance.

### Long-wavelength ramp (the main trap for the ablation)
A plane fitted to all good pixels has a gradient of {ramp['east_mm_yr_per_10km']:+.2f} mm/yr per 10 km
east and {ramp['north_mm_yr_per_10km']:+.2f} per 10 km north (≈ {ramp['across_window_mm_yr']:.1f} mm/yr across the window).
That's far larger than any plausible real tilt of NYC. It's residual tropospheric or ionospheric
signal, plus a small plate-motion/LOS-geometry term (DISP-S1 v1 applies neither correction). As
measured, the building velocity therefore partly encodes **borough**:

| borough | median building velocity, as measured | median, ~2 km high-pass |
|---|---|---|
{boro_md}

For the ablation, use the ramp-free columns: `insar_vel_hp2km_mm_yr`,
`insar_vel_diff_local_mm_yr`, `insar_vel_iqr_mm_yr` and the quality/noise columns. Don't use
raw `insar_vel_los_mm_yr` / `insar_vel_vert_mm_yr` unless borough is already controlled for.

### Confound check: correlation with building height (Spearman ρ)
Tall-building scatterers carry DEM-error, layover and thermal-expansion effects. If a feature
mostly tracks height, any "gain" in the ablation may just be height (likely already a model input).

| feature | ρ with `height_roof_ft` | n |
|---|---|---|
{corr_md}

![velocity map](figures/velocity_map.png)
![distributions](figures/distributions.png)

## Coverage of the FISP universe
- {rep['buildings_total']:,} distinct FISP BINs; {rep['buildings_located']:,} located (footprint centroid or PLUTO lot);
  {rep['buildings_in_window']:,} inside the window; **{rep['buildings_with_data']:,} with InSAR features
  ({rep['coverage_of_fisp_universe']:.1%} of the universe, {rep['coverage_of_in_window']:.1%} of in-window BINs)**.
- By borough: {cov_b}.
- Buildings whose centroid pixel is flagged layover/shadow in the static layer: {rep['building_layover_shadow_frac']:.1%}.

## Sanity check against Buzzanga et al. (2023)
Published rates are vertical, GNSS-tied, and span 2016–2023. Ours are LOS / cos θ (assumes no
horizontal motion), span {rep['first_secondary'][:4]}–{rep['last_secondary'][:4]}, and are relative to the NYC-window median, which absorbs
the regional ≈ −1.6 mm/yr (glacial isostatic adjustment). The fair comparison is
"published minus NYC mean" against "ours".

| site | ours, vertical (mm/yr) | ours minus 2 km median | published | published minus NYC mean (−1.6) |
|---|---|---|---|---|
{chr(10).join(sites_md)}

![sanity zoom](figures/sanity_zoom.png)
{"![sanity sites](figures/sanity_sites.png)" if has_series else ""}

## Caveats
- 30 m pixels average many scatterers: features are block-scale, not façade-scale. With
  {rep['thresholds']['R_BUILDING_M']:.0f} m sampling, a building's value is the median of ≈9 pixels shared with neighbours.
- LOS geometry: one ascending track; east-west motion and vertical motion are mixed. The
  vertical figures assume purely vertical motion.
- Tall buildings: layover and thermal expansion of high-rise façades (seasonal term) can
  dominate; Copernicus DEM geocoding of roof scatterers is approximate.
- No tropospheric correction (OPERA TROPO not applied). Re-referencing every epoch to the window
  median removes the common-mode part only.
- This is ground/structure motion, **not structural-safety evidence**. A null result in the
  ablation is the expected outcome.
"""
    (HERE / "QUALITY_REPORT.md").write_text(md)
    print(md)


if __name__ == "__main__":
    main()
