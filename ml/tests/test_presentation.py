"""Offline notebook checks. Real municipal execution is a separate acceptance run."""
import copy
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import numpy as np
import pytest

nbformat = pytest.importorskip("nbformat", reason="Install ml/notebooks/requirements.txt for notebook checks")
pytest.importorskip("matplotlib")

NOTEBOOKS = Path(__file__).resolve().parents[1] / "notebooks"
REPO = NOTEBOOKS.parents[1]
sys.path.insert(0, str(NOTEBOOKS))
import presentation as p
import satellite


def test_notebook_structure_compilation_and_no_saved_outputs():
    nb = nbformat.read(NOTEBOOKS / "Urban_Sentinel_LinuxONE.ipynb", as_version=4)
    nbformat.validate(nb)
    for cell in nb.cells:
        if cell.cell_type == "code":
            compile(cell.source, cell.id, "exec")
            assert not cell.outputs and cell.execution_count is None
    source = "\n".join(c.source for c in nb.cells)
    assert "REBUILD_SATELLITE = False" in source
    assert all(f"# 0{i} ·" in source for i in range(1, 7))


def test_output_override_is_backward_compatible(tmp_path):
    script = "from urban_sentinel.config import REPORTS_DIR,DATA_DIR; print(REPORTS_DIR); print(DATA_DIR)"
    env = {k: v for k, v in os.environ.items() if k not in {"URBAN_SENTINEL_DATA_DIR", "URBAN_SENTINEL_REPORTS_DIR"}}
    env["PYTHONPATH"] = str(REPO / "ml")
    default = subprocess.check_output([sys.executable, "-c", script], env=env, text=True).splitlines()
    assert default == [str(REPO / "ml/reports"), str(REPO / "data")]
    env.update(URBAN_SENTINEL_DATA_DIR=str(tmp_path), URBAN_SENTINEL_REPORTS_DIR=str(tmp_path / "reports"))
    overridden = subprocess.check_output([sys.executable, "-c", script], env=env, text=True).splitlines()
    assert overridden == [str(tmp_path / "reports"), str(tmp_path)]


def test_outside_run_directory_rejected(tmp_path):
    with pytest.raises(ValueError, match="data/presentation"):
        p.configure(tmp_path, tmp_path / "models")


def test_loaded_config_requires_restart(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "urban_sentinel.config", object())
    with pytest.raises(RuntimeError, match="Restart the kernel"):
        p.configure(tmp_path, tmp_path / "data/presentation/test")


@pytest.mark.parametrize("error", [ImportError, OSError, RuntimeError])
def test_missing_or_broken_dependencies_actionable(monkeypatch, error):
    def missing(name):
        if name == "xgboost":
            raise error("private path / native library diagnostic")
    monkeypatch.setattr(importlib, "import_module", missing)
    with pytest.raises(RuntimeError, match="OpenMP") as exc:
        p.check_dependencies()
    assert "xgboost" in str(exc.value) and "private path" not in str(exc.value)


def test_network_failure_has_no_completed_receipt(tmp_path, monkeypatch):
    from urban_sentinel import config
    from urban_sentinel.featureset import Context
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "RAW_DIR", tmp_path / "raw")
    def offline(*args, **kwargs):
        raise OSError("https://secret.invalid/?signed=DO_NOT_PRINT")
    monkeypatch.setattr(Context, "load", offline)
    with pytest.raises(RuntimeError, match="internet access") as exc:
        p.prepare_data()
    assert "DO_NOT_PRINT" not in str(exc.value)
    assert not (tmp_path / "prepared.json").exists()


def test_changed_snapshot_refused_before_loading(tmp_path, monkeypatch):
    from urban_sentinel import config
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "RAW_DIR", tmp_path / "raw")
    p.save_json(tmp_path / "prepared.json", {"raw_sha256": {"changed": "hash"}})
    with pytest.raises(RuntimeError, match="snapshot changed"):
        p.prepare_data()


def test_hashes_detect_content_changes(tmp_path):
    p.save_json(tmp_path / "one.json", {"value": 1})
    before = p.file_hashes(tmp_path)
    p.save_json(tmp_path / "one.json", {"value": 2})
    assert p.file_hashes(tmp_path) != before


def test_safe_selection_and_fallback():
    def row(rank, status):
        return {"prediction": {"rank": rank}, "fisp": {"status_on_record": status}}
    records = [row(30, "SAFE"), row(1, "UNSAFE"), row(12, "SAFE"), {"prediction": None}]
    assert p.choose_building(records)["prediction"]["rank"] == 12
    assert p.choose_building(records[1:2])["prediction"]["rank"] == 1
    with pytest.raises(RuntimeError, match="No pending"):
        p.choose_building([])


def test_matching_chart_values_and_denominators():
    import charts
    m = {"dob_cycle9_common_set": {"metrics": {
        key: {"precision@500": value, "n": 1000, "base_rate": .2}
        for key, value in [("dob_predprob_2022", .3), ("rule_prev_status", .4), ("xgboost", .5)]}}}
    rows = charts.comparison_rows(m)
    np.testing.assert_allclose(rows.Precision, [.3, .4, .5])
    for field, changed in [("n", 999), ("base_rate", .3)]:
        wrong = copy.deepcopy(m)
        wrong["dob_cycle9_common_set"]["metrics"]["xgboost"][field] = changed
        with pytest.raises(ValueError, match="same cohort"):
            charts.comparison_rows(wrong)


def test_partial_satellite_outputs_are_not_presented(tmp_path, monkeypatch):
    import charts
    from urban_sentinel import config
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    (outputs / "insar_ground_motion.geojson").write_text("{}")
    monkeypatch.setattr(config, "OUTPUT_DIR", outputs)
    monkeypatch.setattr(config, "REPORTS_DIR", tmp_path / "reports")
    with pytest.raises(RuntimeError, match="Incomplete run-local satellite"):
        charts.satellite(tmp_path)


def test_nnpa_unavailable_reports_cpu(monkeypatch):
    from urban_sentinel import artifacts
    monkeypatch.setattr(artifacts.platform, "machine", lambda: "arm64")
    model = artifacts.DeployedModel.__new__(artifacts.DeployedModel)
    status = model.enable_nnpa(None)
    assert status["engine"] == "xgboost" and "not IBM Z" in status["reason"]


def test_nnpa_absent_on_s390x_reports_cpu(monkeypatch):
    from urban_sentinel import artifacts, nnpa_bench
    monkeypatch.setattr(artifacts.platform, "machine", lambda: "s390x")
    monkeypatch.setattr(nnpa_bench, "find_zdnn", lambda: [])
    model = artifacts.DeployedModel.__new__(artifacts.DeployedModel)
    status = model.enable_nnpa(None)
    assert status["engine"] == "xgboost" and "libzdnn" in status["reason"]


def valid_artifacts():
    block = {"metrics": {"xgboost": {"n": 500, "base_rate": .2, "precision@500": .4, "precision@250": .5},
                         "rule": {"n": 500, "base_rate": .2, "precision@500": .3, "precision@250": .4}}}
    metrics = {"dob_cycle9_common_set": copy.deepcopy(block), "primary_cycle9": {
        "test": {"cutoff": "2020-02-21"}, "metrics": {"xgboost": {"n": 500}},
        "subgroups": {"previously_safe": copy.deepcopy(block)},
        "calibration": {"reliability": [{"n": 500, "mean_predicted": .2, "observed": .2}]}}}
    scores = {"meta": {"n_pending_scored": 1}, "buildings": [{"prediction": {"probability": .2}}]}
    return metrics, scores


def test_result_invariants_accept_valid():
    p.validate_result(*valid_artifacts())


@pytest.mark.parametrize("kind", ["cohort", "cutoff", "calibration", "nan", "count"])
def test_result_invariants_reject_invalid(kind):
    metrics, scores = valid_artifacts()
    if kind == "cohort":
        metrics["dob_cycle9_common_set"]["metrics"]["rule"]["n"] = 501
    elif kind == "cutoff":
        metrics["primary_cycle9"]["test"]["cutoff"] = "2022-01-01"
    elif kind == "calibration":
        metrics["primary_cycle9"]["calibration"]["reliability"][0]["n"] = 499
    elif kind == "nan":
        scores["buildings"][0]["prediction"]["probability"] = float("nan")
    else:
        scores["meta"]["n_pending_scored"] = 2
    with pytest.raises(ValueError):
        p.validate_result(metrics, scores)


def test_disabled_satellite_does_nothing(monkeypatch, tmp_path):
    monkeypatch.setattr(satellite, "preflight", lambda *a: pytest.fail("Disabled preflight was called"))
    assert satellite.run(tmp_path, tmp_path, enabled=False)["status"] == "disabled"
    assert not list(tmp_path.iterdir())


def test_satellite_missing_interpreter(tmp_path):
    with pytest.raises(RuntimeError, match="SATELLITE_PYTHON"):
        satellite.preflight(None, tmp_path)


def test_satellite_disallows_ml_environment(tmp_path):
    with pytest.raises(RuntimeError, match="separate Python"):
        satellite.preflight(sys.executable, tmp_path)


def mock_probe(tmp_path, monkeypatch, code=0):
    executable = tmp_path / "geo-python"
    executable.touch()
    probe = SimpleNamespace(returncode=code, stdout=json.dumps({"machine": "arm64", "system": "Darwin", "python": "3.12", "prefix": str(tmp_path / "geo")}))
    monkeypatch.setattr(satellite.subprocess, "run", lambda *a, **k: probe)
    return executable


def test_satellite_compiled_dependency_failure(tmp_path, monkeypatch):
    executable = mock_probe(tmp_path, monkeypatch, code=1)
    with pytest.raises(RuntimeError, match="GDAL, HDF5 and PROJ"):
        satellite.preflight(executable, tmp_path)


def test_satellite_absent_credentials(tmp_path, monkeypatch):
    executable = mock_probe(tmp_path, monkeypatch)
    monkeypatch.setattr(satellite.netrc, "netrc", lambda: SimpleNamespace(authenticators=lambda _: None))
    with pytest.raises(RuntimeError, match="Earthdata credentials"):
        satellite.preflight(executable, tmp_path)


def test_satellite_stages_paths_and_interpreters(tmp_path):
    run_dir = tmp_path / "data/presentation/test"
    steps = satellite.commands(tmp_path, run_dir, "/separate/python")
    assert len(steps) == 7
    assert all(cmd[0] == "/separate/python" for _, cmd in steps[:-1])
    assert steps[-1][1] == [sys.executable, "-m", "urban_sentinel.insar_ablation"]
    for _, cmd in steps[:-1]:
        for flag in ("--out", "--out-dir", "--sample-out", "--report-json", "--pixel-out"):
            if flag in cmd:
                assert Path(cmd[cmd.index(flag)+1]).is_relative_to(run_dir)
    quality = steps[4][1]
    assert "--stack-dir" in quality and "--buildings" in quality and "--features" in quality


def test_satellite_failure_redacts_child_output(tmp_path, monkeypatch, capsys):
    from urban_sentinel import evidence
    monkeypatch.setattr(evidence, "fingerprint", lambda: {"machine": "arm64"})
    run_dir = tmp_path / "data/presentation/test"
    run_dir.mkdir(parents=True)
    monkeypatch.setattr(satellite, "preflight", lambda *a: {"machine": "arm64"})
    def failed(*args, **kwargs):
        assert kwargs["stdout"] == subprocess.DEVNULL and kwargs["stderr"] == subprocess.DEVNULL
        raise subprocess.CalledProcessError(1, args[0], output="DO_NOT_PRINT signed URL")
    monkeypatch.setattr(satellite.subprocess, "run", failed)
    with pytest.raises(RuntimeError, match="Building locations") as exc:
        satellite.run(tmp_path, run_dir, "/separate/python", enabled=True)
    assert "DO_NOT_PRINT" not in str(exc.value) + capsys.readouterr().out
    manifest = json.loads((run_dir / "satellite_manifest.json").read_text())
    assert manifest["status"] == "failed"
    assert "DO_NOT_PRINT" not in json.dumps(manifest)


def test_satellite_snapshot_readers_do_not_refetch(tmp_path, monkeypatch):
    pytest.importorskip("requests")  # Optional satellite HTTP dependency, not needed by the ML pipeline.
    import importlib.util
    import pandas as pd
    spec = importlib.util.spec_from_file_location("satellite_buildings", REPO / "ml/insar/fetch_buildings.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "_get", lambda *a, **k: pytest.fail("Cached source was refetched"))
    facades = tmp_path / "facades.csv.gz"
    pluto = tmp_path / "pluto.csv.gz"
    pd.DataFrame([{"bin": "1000123", "borough": "Manhattan", "block": "1", "lot": "2"}] * 2).to_csv(facades, index=False)
    pd.DataFrame([{"bbl": "1000010002", "latitude": "40.7", "longitude": "-74.0"}]).to_csv(pluto, index=False)
    fisp = module.fetch_fisp_bins(facades)
    assert len(fisp) == 1 and fisp.iloc[0].bbl == 1000010002
    lots = module.fetch_pluto([1000010002], pluto)
    assert lots.iloc[0].lat == 40.7 and lots.iloc[0].lon == -74
