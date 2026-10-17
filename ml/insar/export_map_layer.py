"""Export the quality-filtered NASA OPERA DISP-S1 ground-motion map layer for the 3D frontend.

Visualization only: InSAR is not a model input (the ablation found no gain). Every point is a measured value at a
FISP building (the median of good 30 m pixels within 50 m of its footprint centroid); nothing is interpolated or
synthesised. Buildings that fail a quality filter are dropped, and the counts are recorded in the metadata.

Input:  data/insar/insar_features_cutoff_2020-02-21.csv.gz   (build_features.py)
        data/insar/F08622_nyc/quality_cutoff_2020-02-21.json  (observation window, LOS geometry)
Output: data/outputs/insar_ground_motion.geojson              (served by the API at /layers/ground-motion.geojson)
        ml/insar/sample_map_layer.geojson                      (<= 20 features, committable)

Usage (from the repo root):
  ml/insar/.venv/bin/python ml/insar/export_map_layer.py [--features ...] [--quality ...] [--out ...]
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
CUTOFF = "2020-02-21"

# Quality filters, applied in this order (dropped counts are reported per filter).
MIN_GOOD_PX_50M = 3        # good 30 m pixels within 50 m of the footprint centroid (no 100 m fallback)
MIN_GOOD_FRAC_50M = 0.5    # share of land pixels within 50 m that pass the pixel quality mask
MIN_TEMPORAL_COHERENCE = 0.7
MAX_ABS_VELOCITY = 5.0     # mm/yr, ramp-free; ~25 MADs out. Construction sites and water edges, not ground motion
SAMPLE_SIZE = 20

LIMITATIONS = (
    "Block-scale motion of the built surface measured from orbit (30 m pixels shared with neighbours), relative to "
    "the surrounding ~2 km; it is NOT a structural-safety measure, at building scale it is mostly below the noise "
    "floor, and adding it did not improve the façade model."
)


def quality_score(df: pd.DataFrame) -> pd.Series:
    """0..1: mean of temporal coherence (rescaled from 0.7..1), good-pixel share, and pixel support (n/9)."""
    tcoh = ((df["insar_tcoh_mean"] - MIN_TEMPORAL_COHERENCE) / (1 - MIN_TEMPORAL_COHERENCE)).clip(0, 1)
    support = (df["insar_n_px_50m"] / 9).clip(0, 1)
    return ((tcoh + df["insar_good_frac_50m"].clip(0, 1) + support) / 3).round(2)


def build_layer(features: pd.DataFrame, quality: dict) -> tuple[dict, pd.DataFrame]:
    df = features[features["insar_has_data"] == 1].copy()
    filters = [
        ("has InSAR measurement", features["insar_has_data"] == 1, len(features)),
    ]
    steps = [
        (f"≥ {MIN_GOOD_PX_50M} good pixels within 50 m", lambda d: d["insar_n_px_50m"] >= MIN_GOOD_PX_50M),
        (f"good-pixel share within 50 m ≥ {MIN_GOOD_FRAC_50M}", lambda d: d["insar_good_frac_50m"] >= MIN_GOOD_FRAC_50M),
        (f"mean temporal coherence ≥ {MIN_TEMPORAL_COHERENCE}", lambda d: d["insar_tcoh_mean"] >= MIN_TEMPORAL_COHERENCE),
        ("not in radar layover/shadow", lambda d: d["insar_layover_shadow"].fillna(0) == 0),
        ("finite velocity and standard error", lambda d: np.isfinite(d["insar_vel_hp2km_mm_yr"]) & np.isfinite(d["insar_vel_se_mm_yr"])),
        (f"|velocity| ≤ {MAX_ABS_VELOCITY} mm/yr (outliers: construction, water edges)",
         lambda d: d["insar_vel_hp2km_mm_yr"].abs() <= MAX_ABS_VELOCITY),
    ]
    filter_log = [{"filter": filters[0][0], "kept": int(len(df)), "dropped": int(filters[0][2] - len(df))}]
    for name, rule in steps:
        keep = rule(df)
        filter_log.append({"filter": name, "kept": int(keep.sum()), "dropped": int((~keep).sum())})
        df = df[keep]

    los_up = quality.get("los_up_median") or 0.792
    df = df.assign(
        quality=quality_score(df),
        vertical=(df["insar_vel_hp2km_mm_yr"] / los_up),
        significant=df["insar_vel_hp2km_mm_yr"].abs() > 2 * df["insar_vel_se_mm_yr"],
    )

    def feature(r) -> dict:
        props = {
            "bin": str(int(r.bin)),
            "velocity_mm_yr": round(float(r.insar_vel_hp2km_mm_yr), 2),
            "vertical_approx_mm_yr": round(float(r.vertical), 2),
            "velocity_se_mm_yr": round(float(r.insar_vel_se_mm_yr), 2),
            "local_differential_mm_yr": None if pd.isna(r.insar_vel_diff_local_mm_yr)
            else round(float(r.insar_vel_diff_local_mm_yr), 2),
            "quality": float(r.quality),
            "significant": bool(r.significant),
        }
        return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(float(r.lon), 6), round(float(r.lat), 6)]},
                "properties": props}

    obs_start = quality.get("first_secondary", "2016-09-26")
    obs_end = quality.get("last_secondary", "2020-02-14")
    ref_date = (quality.get("reference_dates") or ["2016-07-16"])[0]
    metadata = {
        "title": "NASA OPERA DISP-S1 ground motion at FISP buildings (measured, quality-filtered)",
        "measurement": "Line-of-sight (LOS) velocity relative to the surrounding ~2 km",
        "units": "mm/yr",
        "sign_convention": "positive = motion toward the satellite (≈ uplift); negative = away (≈ subsidence)",
        "velocity_definition": (
            "Per building: median velocity of good 30 m pixels within 50 m of the footprint centroid, minus the ~2 km "
            "background (300 m block medians, 2.1 km moving median). This removes a ~5 mm/yr long-wavelength artefact "
            "ramp across the city; velocities are relative, not absolute."),
        "vertical_approx_definition": f"velocity_mm_yr / {los_up:.3f} (median LOS up-component); assumes purely vertical motion",
        "velocity_se_definition": "formal least-squares standard error (white-noise assumption; optimistic)",
        "significant_definition": "|velocity_mm_yr| > 2 × velocity_se_mm_yr",
        "quality_definition": "0–1 mean of rescaled temporal coherence (0.7→1), good-pixel share within 50 m, and pixel support (n/9)",
        "relative_to": "~2 km surroundings (not absolute; regional subsidence and the artefact ramp are removed)",
        "satellite": "Sentinel-1A/B (C-band SAR)",
        "product": "NASA OPERA L3 DISP-S1 v1.0",
        "frame": "F08622 (ascending)",
        "pixel_size_m": 30,
        "observation_start": obs_start,
        "observation_end": obs_end,
        "reference_date": ref_date,
        "n_epochs": quality.get("n_epochs"),
        "quality_filters": filter_log,
        "n_features": int(len(df)),
        "n_fisp_buildings": int(len(features)),
        "limitations": LIMITATIONS,
        "provenance": {
            "cmr_collections": {"OPERA_L3_DISP-S1_V1": "C3294057315-ASF", "OPERA_L3_DISP-S1-STATIC_V1": "C3959290248-ASF"},
            "buildings": "NYC Open Data: FISP filings xubg-57si (BINs), Building Footprints 5zhs-2jue, PLUTO 64uk-42ks",
            "processing": "ml/insar/build_features.py (cutoff 2020-02-21), ml/insar/export_map_layer.py",
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
    }
    layer = {"type": "FeatureCollection", "metadata": metadata,
             "features": [feature(r) for r in df.itertuples(index=False)]}
    return layer, df


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--features", type=Path, default=REPO / f"data/insar/insar_features_cutoff_{CUTOFF}.csv.gz")
    ap.add_argument("--quality", type=Path, default=REPO / f"data/insar/F08622_nyc/quality_cutoff_{CUTOFF}.json")
    ap.add_argument("--out", type=Path, default=REPO / "data/outputs/insar_ground_motion.geojson")
    ap.add_argument("--sample-out", type=Path, default=HERE / "sample_map_layer.geojson")
    args = ap.parse_args()

    features = pd.read_csv(args.features)
    quality = json.loads(args.quality.read_text()) if args.quality.exists() else {}
    layer, kept = build_layer(features, quality)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(layer, separators=(",", ":"), ensure_ascii=False))

    # Committable sample: up to 4 per borough, deterministic, keeping the full metadata block
    sample_bins = set(kept.groupby("borough").sample(n=4, random_state=0, replace=False)["bin"].astype(int).astype(str)
                      if kept["borough"].value_counts().min() >= 4 else kept.head(SAMPLE_SIZE)["bin"].astype(int).astype(str))
    sample = {**layer, "features": [f for f in layer["features"] if f["properties"]["bin"] in sample_bins][:SAMPLE_SIZE]}
    args.sample_out.write_text(json.dumps(sample, indent=1, ensure_ascii=False) + "\n")

    m = layer["metadata"]
    print(json.dumps({"out": str(args.out), "bytes": args.out.stat().st_size, "features": m["n_features"],
                      "of_fisp_buildings": m["n_fisp_buildings"], "significant": int(kept["significant"].sum()),
                      "filters": m["quality_filters"], "sample": str(args.sample_out),
                      "sample_features": len(sample["features"])}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
