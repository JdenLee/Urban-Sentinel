# Urban Sentinel · LinuxONE presentation

Open `Urban_Sentinel_LinuxONE.ipynb` in JupyterLab. It is an executable presentation,
not a second model: it calls the production ingestion, feature, evaluation,
training, explanation and parity-checked inference functions. Six presentation
stops precede a technical appendix. The source notebook intentionally has no outputs.

## LinuxONE setup and execution

Use the existing IBM ML Python 3.12 environment inside your LinuxONE Jupyter
container (see `ml/deploy/linuxone/RUNBOOK.md`). Do not replace its NumPy/XGBoost
stack with geospatial packages. These steps run **on the instance**, in the checkout:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
python -m pip install -r ml/notebooks/requirements.txt
python -m ipykernel install --user --name urban-sentinel --display-name 'Urban Sentinel (LinuxONE ML)'
```

Select **Urban Sentinel (LinuxONE ML)** in JupyterLab, restart, then Run All.
Keep any local edits on their own branch before switching. `Urban_Sentinel_Analysis.ipynb`
is the companion exploratory analysis; the presentation notebook rebuilds isolated
artifacts and does not install a model into the live service. The analysis notebook's
optional inference section requires existing deployed artifacts in the configured data directory.
No new Jupyter server is required if the instance already provides JupyterLab.
If launching your own server, bind it to localhost and access it through an SSH
tunnel; keep token authentication enabled. Never record tokens, credentials or
private console details.

For reproducible command-line execution with the named kernel:

```bash
export URBAN_SENTINEL_PRESENTATION_RUN_ID=linuxone-recording
mkdir -p data/presentation/linuxone-recording
python -m nbconvert --execute --to notebook \
  --ExecutePreprocessor.kernel_name=urban-sentinel --ExecutePreprocessor.timeout=7200 \
  --output Urban_Sentinel_LinuxONE.executed --output-dir data/presentation/linuxone-recording \
  ml/notebooks/Urban_Sentinel_LinuxONE.ipynb
python -m nbconvert --to html --no-input \
  --output Urban_Sentinel_LinuxONE --output-dir data/presentation/linuxone-recording \
  data/presentation/linuxone-recording/Urban_Sentinel_LinuxONE.executed.ipynb
```

The run directory must be inside this checkout's `data/presentation/` (gitignored).
Raw cache hashes define a single acquisition snapshot. Fresh run IDs refresh all
municipal sources once; repeating an ID reuses its verified snapshot, but still
re-evaluates, trains and scores. Acquisition is not atomic across NYC endpoints.
Never edit cached files mid-run. A partial acquisition has no completion receipt;
retry it with network access. With a complete cache, municipal execution works
offline. A missing/incomplete cache fails explicitly, with no historical fallback.

`URBAN_SENTINEL_DATA_DIR` and the new backward-compatible
`URBAN_SENTINEL_REPORTS_DIR` redirect all generated artifacts; normal CLI defaults
are unchanged. Notebook execution does not update committed reports, deployed
models, frontend files or API contracts. Restart before changing paths. Do not
run multiple kernels against the same run ID concurrently.

## Local rehearsal

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r ml/requirements.txt -r ml/notebooks/requirements.txt
.venv/bin/python -m ipykernel install --prefix .venv --name urban-sentinel-local
.venv/bin/python -m pip install -r ml/requirements-serve.txt httpx  # existing API tests
PYTHONPATH=ml .venv/bin/python -m pytest ml/tests -q
```

Use `.venv/bin/python` for the export commands above and kernel name
`urban-sentinel-local`. On macOS, XGBoost needs OpenMP (`brew install libomp`);
Linux needs a compatible `libgomp` runtime. The preflight checks imports, not just
package names. If an import fails, repair the selected environment and restart.
On LinuxONE, prefer the supplied IBM ML image over trying to compile the stack.

Local execution is a rehearsal, **not proof of LinuxONE execution**. The notebook
displays its actual OS, architecture, Python, UTC timestamp and model identifier.
`s390x` proves IBM Z architecture, not a specific instance identity; also show the
instance's console/Jupyter page. The historical LinuxONE appendix is explicitly
separate. NNPA uses the existing `DeployedModel.enable_nnpa` parity gate; unavailable
hardware/software falls back visibly to XGBoost. One measured prediction is not a
robust latency benchmark, and inference time excludes explanation/feature work.

## Optional satellite rebuild

Default: disabled; section 05 shows a labeled committed measured export and saved
ablation. It does not fabricate movement or use mock predictions.

Create a **separate** environment compatible with `ml/insar/requirements.txt`; set
`SATELLITE_PYTHON` to that interpreter's absolute path before launching Jupyter.
Do not install these packages into the IBM ML environment. The original geospatial
workflow was developed on a laptop; LinuxONE wheel/compiled-library support is
unverified. No `s390x` claim is inferred from an ML run.

The account owner must privately configure `~/.netrc` for
`urs.earthdata.nasa.gov`, set the Earthdata profile's Study Area, and authorize ASF
data access. Follow `ml/insar/README.md`. Never paste secrets into notebook cells.
The preflight reads credentials without displaying them and imports GDAL/rasterio,
HDF5/h5py and PROJ in the external environment before downloads start.

Set `REBUILD_SATELLITE = True` in setup, restart and Run All. Allow hours, ~2 GB
of subsets, at least 8 GiB free disk and several GiB memory. The stage runner calls:
building locations → subset downloads → perpendicular baselines → movement
features → quality report → map export → ablation. The ablation runs in the ML
environment using this run's municipal cache. All outputs remain in the run folder.
Stage names/timing are shown; child logs are suppressed to prevent signed download
URLs leaking into saved notebook outputs. Inspect safe manifests/quality reports
for results, not private network logs. Successful dependency checks alone do not
verify authenticated reconstruction or its scientific result.

Building-location preparation reuses this run's façade and PLUTO caches. Footprints
are fetched once into a separate run-local geometry cache. Original standalone
satellite CLI defaults remain unchanged; the new cache/output flags are opt-in.

## Recording and provenance

See `RECORDING.md` and the notebook's timed script. Run everything before recording,
then save the executed copy and HTML in the run folder. Scroll through retained
outputs; do not imply scrolling is rerunning computation. Do not commit large
outputs, raw data, models or NASA credentials. Review exported HTML before sharing.

The chart data is derived from run artifacts. The matching DOB cohort, cycle-9
subgroup and calibration cohort are different and labeled. The saved ablation
uses its own recorded cohort; it must not be described as a fresh run unless
reconstruction/ablation succeeded. Missing satellite historical execution metadata
is explicitly unknown, not inferred. Municipal and deployment model differences,
selection bias, current PLUTO snapshots, shared radar pixels and outcome semantics
are explained in the appendix.
