"""Opt-in satellite reconstruction; never installs into or changes the ML kernel.

Child output is intentionally suppressed: remote errors can contain signed URLs.
Only stage names, timings and platform fingerprints enter saved notebook output.
"""
from __future__ import annotations

import json
import netrc
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from presentation import save_json


def preflight(python, run_dir):
    executable = Path(python).absolute() if python else None
    # Do not resolve venv symlinks: distinct environments may share a base binary.
    if not executable or not executable.is_file():
        raise RuntimeError("Set SATELLITE_PYTHON to a separate environment's absolute Python path; see README.md.")
    if executable == Path(sys.executable).absolute():
        raise RuntimeError("Satellite work requires a separate Python environment; do not use the ML kernel.")
    try:
        probe = subprocess.run([str(executable), "-c",
            "import geopandas,rasterio,h5py,h5netcdf,xarray,scipy,pyproj,requests,opera_utils,numpy,pandas,matplotlib,fsspec; "
            "import json,platform,sys; print(json.dumps(dict(machine=platform.machine(),system=platform.system(),python=sys.version.split()[0],prefix=sys.prefix)))"],
            capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        raise RuntimeError("Could not run the satellite dependency probe. Verify SATELLITE_PYTHON permissions and compiled dependencies in the separate environment.") from None
    if probe.returncode:
        raise RuntimeError("Satellite compiled-dependency check failed. Install ml/insar/requirements.txt in the separate environment; verify GDAL, HDF5 and PROJ compatibility.")
    try:
        platform = json.loads(probe.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise RuntimeError("Satellite Python returned an invalid platform probe; check the configured interpreter.") from None
    if Path(platform["prefix"]).resolve() == Path(sys.prefix).resolve():
        raise RuntimeError("Satellite Python points to the ML environment; configure a separate environment.")
    try:
        credentials = netrc.netrc().authenticators("urs.earthdata.nasa.gov")
        ready = bool(credentials and credentials[0] and credentials[2])
    except (OSError, netrc.NetrcParseError):
        ready = False
    if not ready:
        raise RuntimeError("Earthdata credentials are unavailable. Configure a private ~/.netrc entry for urs.earthdata.nasa.gov outside Jupyter, set Study Area, and authorize ASF access. Do not paste credentials into cells.")
    if shutil.disk_usage(run_dir).free < 8 * 1024**3:
        raise RuntimeError("Allow at least 8 GiB free disk space before starting the satellite workflow.")
    return platform


def commands(repo, run_dir, python):
    repo, run_dir = Path(repo), Path(run_dir)
    scripts = repo / "ml/insar"
    stack = run_dir / "insar/F08622_nyc"
    buildings = run_dir / "insar/ref/fisp_buildings.csv.gz"
    features = run_dir / "insar/insar_features_cutoff_2020-02-21.csv.gz"
    quality = stack / "quality_cutoff_2020-02-21.json"
    steps = [
        ("Building locations", "fetch_buildings.py", ["--out", buildings, "--facades-cache", run_dir / "raw/facades.csv.gz", "--pluto-cache", run_dir / "raw/pluto_fisp.csv.gz", "--footprints-cache", run_dir / "insar/ref/footprints.geojson"]),
        ("OPERA subset download", "download_subset.py", ["--frame-id", "8622", "--bbox", "-74.205", "40.532", "-73.703", "40.920", "--start", "2016-07-01", "--end", "2020-02-21", "--workers", "2", "--out-dir", stack]),
        ("Perpendicular baselines", "fetch_bperp.py", ["--stack-dir", stack, "--workers", "2"]),
        ("Movement feature extraction", "build_features.py", ["--stack-dir", stack, "--buildings", buildings, "--cutoff", "2020-02-21", "--out", features, "--report-json", quality, "--pixel-out", stack / "pixel_velocity_cutoff_2020-02-21.nc"]),
        ("Satellite quality report", "quality_report.py", ["--stack-dir", stack, "--features", features, "--buildings", buildings, "--out-dir", run_dir / "reports/insar"]),
        ("Measured map export", "export_map_layer.py", ["--features", features, "--quality", quality, "--out", run_dir / "outputs/insar_ground_motion.geojson", "--sample-out", run_dir / "outputs/insar_sample.geojson"]),
    ]
    result = [(label, [str(python), str(scripts / script), *map(str, args)]) for label, script, args in steps]
    result.append(("Matched-cohort ablation", [sys.executable, "-m", "urban_sentinel.insar_ablation"]))
    return result


def run(repo, run_dir, python=None, enabled=False):
    if not enabled:
        return {"status": "disabled", "note": "Showing explicitly labeled saved satellite research; nothing downloaded."}
    repo, run_dir = Path(repo).resolve(), Path(run_dir).resolve()
    if not run_dir.is_relative_to(repo / "data/presentation"):
        raise ValueError("Satellite output must stay inside data/presentation/.")
    platform = preflight(python, run_dir)
    from datetime import datetime, timezone
    from urban_sentinel.evidence import fingerprint
    manifest = {"status": "running", "started_at": datetime.now(timezone.utc).isoformat(),
                "satellite_platform": platform, "ml_platform": fingerprint(), "stages": []}
    path = run_dir / "satellite_manifest.json"
    save_json(path, manifest)
    env = dict(os.environ, URBAN_SENTINEL_DATA_DIR=str(run_dir), URBAN_SENTINEL_REPORTS_DIR=str(run_dir / "reports"))
    for label, command in commands(repo, run_dir, python):
        print(f"{label}… (external logs suppressed to protect signed URLs)", flush=True)
        start = time.perf_counter()
        try:
            subprocess.run(command, cwd=repo / "ml", env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=6*3600)
        except (subprocess.SubprocessError, OSError):
            manifest.update(status="failed", failed_stage=label)
            save_json(path, manifest)
            raise RuntimeError(f"Satellite stage failed: {label}. Verify network, Earthdata authorization and the separate environment using ml/insar/README.md. Child logs are not saved because they may contain signed URLs. Cached subsets can be reused on retry.") from None
        manifest["stages"].append({"stage": label, "elapsed_seconds": round(time.perf_counter()-start, 1)})
        save_json(path, manifest)
    manifest.update(status="complete", completed_at=datetime.now(timezone.utc).isoformat())
    save_json(path, manifest)
    return manifest
