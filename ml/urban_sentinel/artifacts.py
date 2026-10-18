"""Portable model artifacts: XGBoost JSON + Platt calibration parameters as JSON (no pickle), and the
optional IBM Snap ML engine that serves the same trees on the IBM Z NNPA accelerator.

Text formats avoid the byte-order pitfalls of binary pickles when moving between arm64/x86 laptops and
big-endian IBM Z.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import xgboost as xgb

from . import evidence
from .config import MODEL_DIR
from .models import PlattCalibrator

MODEL_FILE = MODEL_DIR / "facade_unsafe_xgb.json"
SNAPML_MODEL_FILE = MODEL_DIR / "facade_unsafe_xgb_snapml.json"
CALIBRATION_FILE = MODEL_DIR / "facade_unsafe_calibration.json"
META_FILE = MODEL_DIR / "facade_unsafe_meta.json"

# Missing values are encoded as an out-of-range constant before training and scoring. Snap ML's importer does
# not apply XGBoost's learned default direction for NaN, so a NaN-free model is what lets the NNPA serve the
# exact same predictions (verified: max |dp| 3.8e-7 on 13,650 buildings; accuracy unchanged).
MISSING_SENTINEL = -1e6
NNPA_PARITY_TOLERANCE = 1e-5


def encode_missing(X: pd.DataFrame) -> pd.DataFrame:
    return X.fillna(MISSING_SENTINEL)


def save_deployment_model(model: xgb.XGBClassifier, calibrator, *, train_cycles, calibration_cycle, xgb_rounds,
                          test_summary) -> dict:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model.get_booster().save_model(str(MODEL_FILE))
    CALIBRATION_FILE.write_text(json.dumps(calibrator.to_json()))
    meta = {"features": list(model.get_booster().feature_names), "train_cycles": train_cycles,
            "calibration_cycle": calibration_cycle, "xgb_rounds": xgb_rounds,
            "missing_value_sentinel": MISSING_SENTINEL,
            "model_sha256": hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()[:16],
            "trained_on": evidence.fingerprint(), "test_summary": test_summary}
    META_FILE.write_text(json.dumps(meta, indent=2, default=str))
    return meta


@dataclass
class DeployedModel:
    booster: xgb.Booster
    calibrator: PlattCalibrator
    meta: dict
    snapml_model: object | None = None
    nnpa_status: dict = field(default_factory=lambda: {"engine": "xgboost", "reason": "NNPA not initialised"})

    @classmethod
    def load(cls) -> "DeployedModel":
        booster = xgb.Booster()
        booster.load_model(str(MODEL_FILE))
        calibrator = PlattCalibrator.from_json(json.loads(CALIBRATION_FILE.read_text()))
        return cls(booster, calibrator, json.loads(META_FILE.read_text()))

    def _matrix(self, X: pd.DataFrame) -> np.ndarray:
        return encode_missing(X[self.meta["features"]]).to_numpy(dtype=np.float32)

    def predict(self, X) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Batch path (XGBoost): raw score for ranking, calibrated probability and per-feature TreeSHAP."""
        dm = xgb.DMatrix(encode_missing(X[self.meta["features"]]))
        raw = self.booster.predict(dm)
        contrib = self.booster.predict(dm, pred_contribs=True)[:, :-1]
        return raw, self.calibrator.predict(raw), contrib

    def enable_nnpa(self, X_check: pd.DataFrame) -> dict:
        """Load the same trees into IBM Snap ML on the NNPA (`zdnn_tensors`) and keep them only if they reproduce
        XGBoost on `X_check`. Any failure leaves XGBoost as the engine, with the reason recorded."""
        status = {"engine": "xgboost"}
        if platform.machine() != "s390x":
            self.nnpa_status = {**status, "reason": f"not IBM Z ({platform.machine()})"}
            return self.nnpa_status
        from .nnpa_bench import find_zdnn, legacy_xgb_json, zdnn_status  # deferred: nnpa_bench imports this module

        zdnn = next((z for z in map(zdnn_status, find_zdnn()) if z.get("nnpa_installed")), None)
        if zdnn is None:
            self.nnpa_status = {**status, "reason": "libzdnn not found or NNPA not installed"}
            return self.nnpa_status
        os.environ.setdefault("SNAPML_ZDNN_LIB", zdnn["path"])
        try:
            import snapml

            legacy_xgb_json(MODEL_FILE, SNAPML_MODEL_FILE)
            Xc = self._matrix(X_check)
            sm = snapml.BoostingMachineClassifier()
            sm.import_model(str(SNAPML_MODEL_FILE), "xgb_json", tree_format="zdnn_tensors", X=Xc)
            tree_format = getattr(sm.booster_, "optimized_tree_format_", None)
            diff = float(np.abs(sm.predict_proba(Xc)[:, 1] - self.booster.inplace_predict(Xc)).max())
        except Exception as exc:  # missing package, import error, zDNN failure: fall back, record why
            self.nnpa_status = {**status, "reason": f"{type(exc).__name__}: {exc}"}
            return self.nnpa_status
        status.update({"zdnn_version": zdnn.get("library_version"), "tree_format": tree_format,
                       "parity_rows": int(len(Xc)), "parity_max_abs_diff": diff})
        if tree_format == "zdnn_tensors" and diff < NNPA_PARITY_TOLERANCE:
            self.snapml_model = sm
            status["engine"] = "snapml-nnpa"
        else:
            status["reason"] = "Snap ML did not select zdnn_tensors or failed the parity check"
        self.nnpa_status = status
        return status

    def score_live(self, X: pd.DataFrame, engine: str = "auto") -> dict:
        """Per-request scoring: Snap ML on the NNPA when enabled (else XGBoost); explanations via XGBoost
        TreeSHAP, which Snap ML does not provide. engine: "auto" | "nnpa" | "xgboost"."""
        if engine == "nnpa" and self.snapml_model is None:
            raise RuntimeError(f"NNPA engine unavailable: {self.nnpa_status.get('reason')}")
        Xm = self._matrix(X)
        t0 = time.perf_counter()
        if self.snapml_model is not None and engine != "xgboost":
            raw = self.snapml_model.predict_proba(Xm)[:, 1]
            engine = "snapml-nnpa"
        else:
            raw = self.booster.inplace_predict(Xm)
            engine = "xgboost"
        score_ms = (time.perf_counter() - t0) * 1000
        contrib = self.booster.predict(xgb.DMatrix(Xm, feature_names=self.meta["features"]), pred_contribs=True)[:, :-1]
        return {"raw": raw, "probability": self.calibrator.predict(raw), "contrib": contrib, "engine": engine,
                "tree_format": self.nnpa_status.get("tree_format") if engine == "snapml-nnpa" else None,
                "score_ms": score_ms}
