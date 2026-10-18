# Evidence from the team's IBM LinuxONE VM (RHEL 9.8, s390x, big-endian; Podman, IBM jupyterlab-image-s390x)

| file | what it shows |
|---|---|
| `run_manifest_s390x.json` | Full pipeline on s390x: evaluation (226 s; cycle-9 PR-AUC 0.451), training and scoring of 13,650 buildings (39.5 s), with the CPU feature line (includes `nnpa`). |
| `RESULTS.md` | The complete evaluation report regenerated on s390x. The header reads "Run on `s390x`". |
| `nnpa_benchmark_s390x.json` | NNPA check. zDNN 1.1.2 reports `zdnn_is_nnpa_installed() = true`. Snap ML imports the trees as `zdnn_tensors`. A NaN-free model matches XGBoost to within 3.8e-7 on all 13,650 buildings (identical top 500). Timings: one row 0.022 ms on NNPA vs 0.087 ms XGBoost; full batch 134 ms on NNPA vs 49 ms XGBoost. Run on model `f12061750b25f7a4`; its NaN-free variant is the configuration that was then deployed. |
| `health_s390x.json` | The live API on the VM (deployed model `ae2f5d61101a5a7e`). `inference_engine` is `snapml-nnpa` / `zdnn_tensors`, enabled after a 500-building parity check (max abs diff 2.9e-7). |
| `live_score_s390x.json` | `POST /score/2021985`: features recomputed and the prediction made on the NNPA (`engine: snapml-nnpa`, model inference 0.12 ms, 90 ms including feature computation), with XGBoost TreeSHAP explanations. |
| `latency_s390x.json` | Live API on the VM, 200 real buildings scored on both engines back to back via `POST /score/{bin}?engine=…`. Model inference median **0.122 ms on the NNPA vs 0.358 ms with XGBoost** (p95 0.132 vs 0.434). End-to-end 86 ms for both, dominated by rebuilding the building's features. Probabilities agree to 4 decimals for 99.5% of buildings; the max difference of 0.0001 is the API's 4-dp rounding (raw parity is 2.9e-7). |

Claim supported by this evidence: live predictions are computed on IBM Z's on-chip AI accelerator and match the
reference XGBoost model. Per request, the NNPA scores about 2.9× faster than XGBoost on the live API path. End-to-end latency is dominated by feature computation, and batch scoring is faster on the CPU, so no overall speed advantage is claimed.
