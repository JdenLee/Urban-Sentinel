# InSAR ablation inputs: OPERA DISP-S1 ground displacement per FISP building

Optional research ablation for Urban Sentinel: does satellite ground displacement add
predictive value for the next FISP outcome beyond façade history? This folder turns NASA
OPERA DISP-S1 (Sentinel-1 InSAR) displacement into **per-BIN features computed only from
observations before 2020-02-21**, the cycle-9 test cutoff.

**Read this first:** the features are block-scale ground/structure motion measured along the
radar line of sight. They are **not structural-safety evidence**. NYC moves about 1–2 mm/yr,
30 m pixels mix several buildings, and a null ablation result is the expected outcome.

## Results in one screen (cycle-9 cutoff 2020-02-21; full detail in [QUALITY_REPORT.md](QUALITY_REPORT.md))

- **Data:** frame F08622 (ascending), 97 epochs from 2016-09-26 to 2020-02-14 (reference
  2016-07-16), 7 ministacks with clean reference-date chaining. Remote window subsets total
  1.3 GB on disk (≈ 2 GB transferred, vs ≈ 41 GB for full granules).
- **Quality:** 89.4% of land pixels pass (recommended in ≥ 70% of epochs, mean temporal
  coherence ≥ 0.5). Mean coherence on land is 0.885.
- **Coverage:** 16,756 of 16,905 FISP BINs (99.1%) have features. The rest are placeholder
  "million" BINs or BINs with no footprint/PLUTO location.
- **Sanity vs Buzzanga et al. 2023** (vertical, relative to the NYC median):
  - Arthur Ashe Stadium: −3.1 mm/yr, published −3.0 relative to the NYC mean. A match.
  - LaGuardia runway centerlines: −1.1 (−1.6 vs its 2 km surroundings), published −2.1.
    Right sign and size.
  - LaGuardia landside: −0.2. Fill areas subside, the terminal side doesn't.
- **Trap:** there's a ≈ 5.4 mm/yr long-wavelength ramp across the window (uncorrected
  troposphere/ionosphere). Raw velocity therefore encodes borough: Bronx +1.7 vs Staten
  Island −0.9 mm/yr. **Use `insar_vel_hp2km_mm_yr` / `insar_vel_diff_local_mm_yr`**, which
  are ramp-free.
- **Signal vs noise:** after the high-pass, building velocities are tightly bunched (IQR
  −0.16 to +0.23 mm/yr, std 0.61). Only **1.7%** of buildings exceed 2× their formal SE, and
  that SE is itself optimistic. Correlation with building height is weak (|ρ| ≤ 0.10). The
  features are usable, but at building scale most of the signal is below the noise floor.
  **Expect a null ablation.** A few extreme values (±20 mm/yr: construction sites, water edges)
  call for winsorizing or a tree model.

## Route chosen

| route | verdict |
|---|---|
| ASF Displacement Portal (https://displacement.asf.alaska.edu) | Rejected. Interactive only: you click AOIs and export a CSV per chart. No API, and it shows only the *short-wavelength* layer. Not feasible for ~17k buildings. |
| `opera-utils disp-s1-download --bbox …` | Rejected as-is. Over HTTPS it downloads each **full ~420 MB granule** before cropping (97 granules ≈ 41 GB for F08622 pre-cutoff). Its fsspec remote reader also fails with 401: aiohttp drops the auth header on the redirect to Earthdata Login. |
| **opera-utils search + signed-URL byte-range subsetting (used)** | `opera_utils.disp.search` finds the granules (CMR). Each URL is resolved once with `requests` (re-applies `~/.netrc` per host) to its short-lived CloudFront URL, then read with HTTP range requests. Only the HDF5 chunks in the NYC window are transferred: ≈ 20 MB per granule, ≈ 2 GB total, 1.3 GB on disk. |

Frame **F08622** (ascending) alone covers all five boroughs. F28221 and F28222 reach only the
far south of Staten Island; F30175 starts in 2019. One frame means one geometry and one
reference point, with no frame stitching needed.

## One-time Earthdata setup (account owner only)

1. Earthdata Login account, plus a `~/.netrc` entry (`chmod 600`):
   `machine urs.earthdata.nasa.gov login <user> password "<password>"`.
   Double-quote the password if it contains a backslash, quote or `#`; otherwise Python's
   `netrc` (used by opera-utils) mangles it.
2. Set **Study Area** in the Earthdata profile. ASF rejects requests otherwise, with
   "Please update your profile for application required attributes Study Area".
3. Pre-authorize ASF's app at
   https://urs.earthdata.nasa.gov/approve_app?client_id=BO_n7nTIlMljdvU6kRRB3g.

## Exact commands (run from the repo root, on a laptop, not the LinuxONE VM)

```bash
python3.12 -m venv ml/insar/.venv
ml/insar/.venv/bin/pip install -r ml/insar/requirements.txt

# 1. FISP building universe -> one centroid per BIN (Socrata, no auth)
ml/insar/.venv/bin/python ml/insar/fetch_buildings.py

# 2. Remote-subset all pre-cutoff granules + static LOS/layover layers (~15 min, ~2 GB transfer)
ml/insar/.venv/bin/python ml/insar/download_subset.py --frame-id 8622 \
    --bbox -74.205 40.532 -73.703 40.920 --start 2016-07-01 --end 2020-02-21 \
    --out-dir data/insar/F08622_nyc --workers 8

# 3. Perpendicular baseline per epoch (for the DEM-error term, ~2 min)
ml/insar/.venv/bin/python ml/insar/fetch_bperp.py --stack-dir data/insar/F08622_nyc

# 4. Time series -> per-pixel velocity -> per-BIN features (~2 min, ~3 GB RAM)
ml/insar/.venv/bin/python ml/insar/build_features.py --stack-dir data/insar/F08622_nyc --cutoff 2020-02-21

# 5. Quality report, figures, sample rows
ml/insar/.venv/bin/python ml/insar/quality_report.py --stack-dir data/insar/F08622_nyc --cutoff 2020-02-21
```

Only `data/insar/insar_features_cutoff_2020-02-21.csv.gz` (~2 MB) needs to go to the VM.

## Processing (what `build_features.py` does)

1. **Granules:** secondary date < cutoff, newest generation per (reference, secondary) pair.
2. **Correction:** `displacement − corrections/solid_earth_tide`, the same default as
   `opera_utils` `reformat_stack`. The ionosphere layer is not applied: it is long-wavelength
   and removed by step 4.
3. **Reference-date chaining:** DISP-S1 restarts its reference date every ~6 months
   (ministacks). Products are chained by exact date matching: each new reference date must
   equal an earlier product's secondary date, or the script stops chaining loudly. It is
   cross-checked against `opera_utils.disp._rebase.rebase_timeseries` on a pixel sample.
4. **Spatial reference:** each epoch is re-referenced to the median of strict high-quality
   pixels in the window. The product's own reference pixel is in New Jersey (40.75 N, 74.22 W).
   Velocities are therefore relative to the NYC median, which removes the regional ≈ −1.6 mm/yr
   glacial-isostatic subsidence and common-mode atmosphere.
5. **Quality masks:** pixel is "good" if it is land (`water_mask`), `recommended_mask` = 1 and
   finite in ≥ 70% of epochs, and has mean `temporal_coherence` ≥ 0.5. Per-epoch weights in the
   fit are `recommended_mask` & finite. `persistent_scatterer_mask` is summarised as a feature.
6. **Per-pixel weighted least squares** (time in years, centred):
   `d = a + v·t + annual sin/cos + c·B⊥(t)` gives velocity, seasonal amplitude, residual RMS
   and DEM error. Adding `acc·t²/2` gives acceleration. B⊥ is the chained perpendicular
   baseline at the window centre. Its coefficient absorbs scatterer-height (DEM) error,
   ΔLOS = B⊥·Δh/(R sin θ), which is large for high-rise roofs.
7. **LOS → vertical:** `v_up ≈ v_los / los_up` (static `line_of_sight_enu` band 3, cos θ ≈ 0.79,
   θ ≈ 37.6°). This assumes no horizontal motion and is used only for the sanity check and
   one feature.
8. **High-pass (~2 km):** velocity minus a robust background (300 m block medians, then a
   2.1 km moving median). This removes the long-wavelength ramp (~4 mm/yr across the window,
   see the quality report) and keeps landfill/runway/stadium-scale signals.
9. **Per building:** good pixels within 50 m of the footprint centroid (100 m fallback), using
   medians. Local differential motion = building velocity − median of good pixels within 200 m.

## Feature file: `data/insar/insar_features_cutoff_2020-02-21.csv.gz`

One row per distinct FISP BIN (`xubg-57si`). Join on `bin` (int). Units: mm, mm/yr, m.
Sign: positive = motion toward the satellite (≈ uplift), negative = away (≈ subsidence).

| column | meaning |
|---|---|
| `bin`, `bbl`, `borough`, `lon`, `lat`, `loc_source` | identity; `loc_source` ∈ footprint / pluto_lot / none (placeholder BINs like 1000000 get none) |
| `insar_vel_hp2km_mm_yr` | **recommended** velocity feature: LOS velocity minus the ~2 km background (ramp-free) |
| `insar_vel_los_mm_yr` | median LOS velocity of the building's good pixels, as measured. Includes the long-wavelength ramp, so it partly encodes borough |
| `insar_vel_vert_mm_yr` | same, LOS / cos θ (same ramp caveat) |
| `insar_vel_se_mm_yr` | median formal velocity SE (white-noise, optimistic) |
| `insar_acc_los_mm_yr2`, `insar_acc_se_mm_yr2` | quadratic-term acceleration and its SE |
| `insar_vel_local_med_200m` | median velocity of good pixels within 200 m |
| `insar_vel_diff_local_mm_yr` | **local differential motion**: building − 200 m neighbourhood |
| `insar_vel_iqr_mm_yr` | spread of pixel velocities at the building |
| `insar_seasonal_amp_mm` | annual amplitude (thermal expansion and moisture) |
| `insar_resid_rms_mm` | residual RMS (noise level) |
| `insar_dem_err_m` | fitted scatterer-height error vs the DEM (large for tall buildings) |
| `insar_tcoh_mean`, `insar_ps_frac`, `insar_good_frac_50m` | quality: temporal coherence, persistent-scatterer fraction, good / land pixels within 50 m |
| `insar_n_px_50m`, `insar_n_px_100m`, `insar_n_px_200m`, `insar_land_px_50m`, `insar_dist_good_px_m`, `insar_radius_used_m` | support / valid-pixel counts |
| `insar_layover_shadow` | static layover/shadow flag at the centroid pixel |
| `insar_in_window`, `insar_has_data`, `insar_cutoff`, `insar_n_epochs` | bookkeeping |

`sample_features.txt` holds ≤ 20 sample rows. It is CSV content; the repo gitignores `*.csv`.

## Leakage note for the ablation

- **Test fold (cycle 9, cutoff 2020-02-21): clean.** Every displacement value comes from an
  acquisition before the cutoff (2016-07-16 reference → last pre-cutoff secondary). The static
  layers do not change over time, and building locations are static geometry. The FISP BIN list
  defines which rows exist, not any feature values.
- **Training folds (cycles 7–8, cutoffs 2010/2015): no time-respecting InSAR exists.** DISP-S1
  starts in July 2016. The practical ablation attaches this one file to *every* row as a
  static building covariate ("this block's 2016–2020 motion regime"). That doesn't contaminate
  the cycle-9 test metric, but for training rows the feature is measured after their cutoff.
  One subtle path: cycle-8 repairs (scaffolding, sheds, façade work during 2016–2020) can
  change radar scatterers. That makes the features partly a proxy for cycle-8 outcomes, which
  the model already sees as façade history. State this in the write-up. A cleaner alternative
  is to compare with/without InSAR inside cycle 9 only (grouped CV on cycle-9 rows).

## Data provenance

- OPERA L3 DISP-S1 v1.0 (`OPERA_L3_DISP-S1_V1`, CMR `C3294057315-ASF`), frame F08622, from ASF DAAC.
  Product generation dates are in `data/insar/F08622_nyc/manifest.csv`.
- OPERA L3 DISP-S1-STATIC v1.0 (`C3959290248-ASF`): `line_of_sight_enu`, `layover_shadow_mask`.
- NYC Open Data: FISP filings `xubg-57si`, Building Footprints `5zhs-2jue`, PLUTO `64uk-42ks`.
- Reference values: Buzzanga, B. et al. (2023), "Localized uplift, widespread subsidence, and
  implications for sea level rise in the New York City metropolitan area", *Science Advances*
  9, eadi8259.

## Files

| file | role |
|---|---|
| `fetch_buildings.py` | FISP BINs → footprint centroid (PLUTO fallback) |
| `download_subset.py` | CMR search, dedupe, signed-URL window subsetting, static layers |
| `fetch_bperp.py` | per-epoch perpendicular baseline |
| `build_features.py` | correction, chaining, re-referencing, fits, per-BIN features, quality JSON |
| `quality_report.py` | `QUALITY_REPORT.md`, `figures/`, `sample_features.txt` |
| `requirements.txt` | pinned versions used |
