"""Portable model artifacts: XGBoost JSON + isotonic thresholds as JSON (no pickle).

Text formats avoid the byte-order pitfalls of binary pickles when moving between arm64/x86 laptops and
big-endian IBM Z.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

import numpy as np
import xgboost as xgb

from . import evidence
from .config import MODEL_DIR
from .features import FACADE_FEATURES

MODEL_FILE = MODEL_DIR / "facade_unsafe_xgb.json"
CALIBRATION_FILE = MODEL_DIR / "facade_unsafe_calibration.json"
META_FILE = MODEL_DIR / "facade_unsafe_meta.json"


def save_deployment_model(model: xgb.XGBClassifier, calibrator, *, train_cycles, calibration_cycle, xgb_rounds,
                          test_summary) -> dict:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model.get_booster().save_model(str(MODEL_FILE))
    CALIBRATION_FILE.write_text(json.dumps({"x": calibrator.X_thresholds_.tolist(),
                                            "y": calibrator.y_thresholds_.tolist()}))
    meta = {"features": FACADE_FEATURES, "train_cycles": train_cycles, "calibration_cycle": calibration_cycle,
            "xgb_rounds": xgb_rounds, "model_sha256": hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()[:16],
            "trained_on": evidence.fingerprint(), "test_summary": test_summary}
    META_FILE.write_text(json.dumps(meta, indent=2, default=str))
    return meta


@dataclass
class DeployedModel:
    booster: xgb.Booster
    cal_x: np.ndarray
    cal_y: np.ndarray
    meta: dict

    @classmethod
    def load(cls) -> "DeployedModel":
        booster = xgb.Booster()
        booster.load_model(str(MODEL_FILE))
        cal = json.loads(CALIBRATION_FILE.read_text())
        return cls(booster, np.asarray(cal["x"]), np.asarray(cal["y"]), json.loads(META_FILE.read_text()))

    def predict(self, X) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Returns raw score (for ranking), calibrated probability (for display) and per-feature SHAP."""
        dm = xgb.DMatrix(X[self.meta["features"]])
        raw = self.booster.predict(dm)
        calibrated = np.interp(raw, self.cal_x, self.cal_y)  # == IsotonicRegression(out_of_bounds="clip")
        contrib = self.booster.predict(dm, pred_contribs=True)[:, :-1]
        return raw, calibrated, contrib
