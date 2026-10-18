# Running the façade model on IBM LinuxONE (RHEL 9.8 · s390x · Podman)

Everything runs inside IBM's `jupyterlab-image-s390x`. It already has numpy 2.0.2, pandas 3.0.6, scikit-learn 1.9.0
and XGBoost 3.4.1, so **training, evaluation and inference all execute on IBM Z**. Only `fastapi`/`uvicorn` (and
`pytest`, if missing) are added. They're installed into the shared mount, so the image and the running `notebook`
container are untouched.

Notation: `$VM` = the VM's public IP. Host path `/home/linux1/shared` = container path `/home/ibm-user/shared`.

## 0. Check the environment (paste the output back to the ML channel)
```bash
ssh -i ~/.ssh/<key>.pem linux1@$VM
podman ps --format '{{.Names}} {{.Image}} {{.Status}}'
podman inspect notebook --format '{{.HostConfig.NetworkMode}} {{range .Mounts}}{{.Source}}->{{.Destination}} {{end}}'
podman exec notebook sh -c 'uname -m; which python3; python3 -V; python3 -m pip list 2>/dev/null | grep -Ei "^(numpy|pandas|scikit-learn|xgboost|pytest|fastapi|uvicorn) "'
grep -m1 -E "machine|features" /proc/cpuinfo
```

## 1. Get the code into the shared mount (only that path is visible inside the container)
```bash
cd /home/linux1/shared
git clone https://github.com/JdenLee/megatron.git      # first time; afterwards: cd megatron && git pull
cd megatron && git checkout feature/nyc-ml && git pull
```

## 2. Add the API dependencies to the shared mount (one time)
```bash
podman exec notebook python3 -m pip install --no-cache-dir --target /home/ibm-user/shared/pydeps \
    fastapi==0.143.3 uvicorn==0.54.0 pytest
podman exec notebook python3 -m pip install --no-cache-dir --no-deps --target /home/ibm-user/shared/pydeps snapml
```
- Snap ML (IBM) serves the model on the on-chip NNPA accelerator. It uses the container's `/usr/local/lib/libzdnn.so`.
- At API start-up it is enabled only if Snap ML selects `zdnn_tensors` **and** reproduces XGBoost within 1e-5 on
  500 buildings. Otherwise the API serves with XGBoost and `/health` explains why.
`pydantic-core` is the only compiled dependency, and it publishes s390x wheels. If pip tries to compile anything,
stop and report it.

## 3. Tests on big-endian IBM Z (includes the cross-architecture parity test)
```bash
podman exec -w /home/ibm-user/shared/megatron/ml -e PYTHONPATH=/home/ibm-user/shared/pydeps notebook \
    python3 -m pytest tests -q -s
```
Expected: `8 passed`, plus the line `parity on big-endian vs fixture from arm64`.

## 4. Full pipeline on s390x: download → evaluate → train → score
```bash
podman exec -w /home/ibm-user/shared/megatron/ml notebook python3 -m urban_sentinel.pipeline
```
- Takes a few minutes on 3 vCPUs, and needs outbound HTTPS to data.cityofnewyork.us and raw.githubusercontent.com.
- Writes `data/outputs/buildings_scores.json`, `data/models/*` (trained here), `ml/reports/RESULTS.md` (its header
  says `Run on s390x`) and `ml/reports/run_manifest_s390x.json`.
- Later rescoring without re-running the evaluation:
  `... python3 -m urban_sentinel.pipeline --refresh --skip-eval`

## 5. Serve the API (bound to localhost only; no public port)
**Option A: inside the existing `notebook` container.** Use this if step 0 shows `host` network mode.
```bash
podman exec -d -w /home/ibm-user/shared/megatron/ml -e PYTHONPATH=/home/ibm-user/shared/pydeps \
    -e URBAN_SENTINEL_ADMIN_TOKEN="$(openssl rand -hex 16)" notebook \
    python3 -m uvicorn urban_sentinel.serve:app --host 127.0.0.1 --port 8000
```

**Option B: a separate container from the same image**, publishing to the VM's loopback only.
```bash
IMAGE=$(podman inspect notebook --format '{{.ImageName}}')
podman run -d --name urban-api -p 127.0.0.1:8000:8000 \
    -v /home/linux1/shared:/home/ibm-user/shared:z \
    -w /home/ibm-user/shared/megatron/ml -e PYTHONPATH=/home/ibm-user/shared/pydeps \
    --entrypoint python3 "$IMAGE" -m uvicorn urban_sentinel.serve:app --host 0.0.0.0 --port 8000
podman logs -f urban-api      # Ctrl-C to stop following
```
`:z` (lowercase) lets SELinux on RHEL share the mount between `notebook` and `urban-api`.

Restart the API after re-training (it loads the model at start-up):
```bash
# the IBM image has no pkill, so stop the server with Python
podman exec notebook python3 -c "import os,signal; [os.kill(int(p),signal.SIGTERM) for p in os.listdir('/proc') if p.isdigit() and b'urban_sentinel.serve' in open(f'/proc/{p}/cmdline','rb').read()]"
podman top notebook | grep uvicorn      # should print nothing
```
then run the step-5 start command again. Start-up takes about 30 s (NNPA parity check). If curl gets no answer, run the start command without `-d` to see errors. Benchmark/evidence for the accelerator:
`podman exec -w /home/ibm-user/shared/megatron-ml/ml -e PYTHONPATH=/home/ibm-user/shared/pydeps notebook python3 -m urban_sentinel.nnpa_bench`

## 6. Reach it from a laptop through SSH (the frontend uses http://localhost:8000)
```bash
ssh -i ~/.ssh/<key>.pem -N -L 8000:127.0.0.1:8000 linux1@$VM
curl -s localhost:8000/health                       # "machine": "s390x", "inference_engine": {"engine": "snapml-nnpa", ...}
curl -s localhost:8000/buildings/2021985
curl -s -X POST localhost:8000/score/2021985        # live inference on the NNPA: "engine": "snapml-nnpa", model_inference_ms
curl -s "localhost:8000/top?k=10&mode=unknown_risk"
```
CORS allows `localhost:5173` and `localhost:3000` by default. Override with `-e URBAN_SENTINEL_CORS=...`.

## 7. Evidence for the pitch (copy back to the repo from a laptop)
```bash
scp -i ~/.ssh/<key>.pem "linux1@$VM:/home/linux1/shared/megatron/ml/reports/{RESULTS.md,run_manifest_s390x.json}" ml/reports/linuxone/
```
Screenshots to capture:
- `podman ps`
- the pytest parity line
- the pipeline manifest (`machine: s390x`, timings)
- `/health`
- a `POST /score/{bin}` response showing `"machine": "s390x"`

## Security notes
- Never expose port 8000 or the Jupyter port publicly. Use the SSH tunnel.
- `/rescore` requires the `X-Admin-Token` header (set via `URBAN_SENTINEL_ADMIN_TOKEN`). Don't commit it.
- No secrets live in the repo. NYC Open Data needs no key; an optional `SOCRATA_APP_TOKEN` env var raises rate limits.
