# Connect the presentation to LinuxONE

Use your existing VM and SSH key. No public API port or new account/key is needed. Keep the passphrase in your own terminal.

## 1. Separate SSH, API, and browser failures

```sh
# Your laptop: unlock an encrypted key if necessary.
ssh-add /path/to/existing-key

# Read-only remote check. Replace the host and key with your existing configuration.
ssh -i /path/to/existing-key linux1@YOUR_LINUXONE_HOST
uname -m
curl --max-time 10 http://127.0.0.1:8000/health
podman ps --format '{{.Names}} {{.Status}} {{.Ports}}'
```

- SSH `Broken pipe`: the tunnel connection died. The API may still be running.
- SSH authentication failure: check the existing key/agent; do not regenerate the VM or keys just to repair a tunnel.
- Remote health connection refused: the API is not listening on VM loopback port 8000. Inspect the existing deployment before starting another process.
- Remote health succeeds but laptop health fails: repair the tunnel or resolve a local port conflict. Do not kill an unidentified process.

If API startup is needed, follow `ml/deploy/linuxone/RUNBOOK.md` using the **existing deployed checkout path**, not its example branch names. Check `podman inspect notebook --format '{{.HostConfig.NetworkMode}}'` first. Option A works only with host networking; otherwise use the runbook's loopback-published container option. Preserve deployed model/data artifacts. API startup loads data/models and checks NNPA parity; it is not necessary to rerun the full pipeline for each presentation.

## 2. Keep a local-only tunnel open

From a second laptop terminal:

```sh
ssh -i /path/to/existing-key -N \
  -L 127.0.0.1:8000:127.0.0.1:8000 \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  linux1@YOUR_LINUXONE_HOST
```

A healthy `-N` tunnel is silent. Leave its terminal open. Keep-alives detect a dead connection; they cannot prevent VM shutdown or reconnect a broken network automatically.

## 3. Verify actual execution before recording

```sh
curl --max-time 10 http://127.0.0.1:8000/health
curl --max-time 20 -X POST 'http://127.0.0.1:8000/score/1078054?engine=auto'
```

Health returns `platform.machine`, `data_as_of`, `scores_generated_at`, `model` and `inference_engine`. The individual score response must report `machine: s390x` to establish IBM Z execution. `engine: snapml-nnpa` means the accelerator was enabled by the existing parity checks; `xgboost` is a valid **CPU** fallback, not NNPA. Read `model_inference_ms` separately from `total_ms_incl_features`. Do not claim hardware execution from the saved snapshot badge alone.

Set `VITE_API_URL=http://127.0.0.1:8000` in ignored `frontend/.env.local` if needed, restart Vite, and reload the browser. Existing CORS permits both `localhost:5173` and `127.0.0.1:5173`. If the API works with curl but not the browser, check that exact origin and API URL; don't disable browser security. Use a manual **Run on LinuxONE** once before recording; the scripted attempt has a shorter deadline.

## What does the live step prove?

The map reads a saved batch export so it stays responsive and works without an API connection. Live scoring recomputes a single building using the service's loaded model and cached municipal context, with the current cutoff. It reports which machine/engine actually executed it and how long that took. It does **not** retrain, refresh public records, or make a prediction inherently more accurate. With identical features/model it should agree with the batch score. A changed date, cached snapshot, or model can produce a different number; the UI keeps the batch map/explanations distinct.

Suggested narration: “These scores were precomputed for fast map exploration. This request demonstrates the same inference workflow running now on our LinuxONE instance.”

No remote execution is established by local frontend tests. Capture a successful live response on your own instance before making that claim.
