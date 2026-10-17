"""Baselines and the gradient-boosted model."""
from __future__ import annotations

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

XGB_PARAMS = dict(
    n_estimators=2000, learning_rate=0.03, max_depth=4, min_child_weight=10, subsample=0.8,
    colsample_bytree=0.8, reg_lambda=2.0, objective="binary:logistic", eval_metric="aucpr",
    tree_method="hist", n_jobs=3, random_state=0,  # n_jobs=3 matches the LinuxONE VM's vCPUs
)


def rule_score(X: pd.DataFrame) -> np.ndarray:
    """What an inspector would do without a model: rank by last recorded status (UNSAFE > SWARMP >
    no history > SAFE), breaking ties by how many past cycles were UNSAFE."""
    tier = X["last_status"].map({2: 3.0, 1: 2.0, -1: 1.5, 0: 1.0}).to_numpy()
    return tier + 0.01 * X["n_unsafe"].to_numpy()


LOGIT_CATEGORICAL = ["last_status", "prev_status"]
LOGIT_NUMERIC = ["n_cycles_filed", "n_unsafe", "n_swarmp", "unsafe_streak", "nrf_prev_cycle", "has_history"]


def fit_logistic(X: pd.DataFrame, y: pd.Series):
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore"), LOGIT_CATEGORICAL),
        ("num", make_pipeline(SimpleImputer(strategy="median"), StandardScaler()), LOGIT_NUMERIC),
    ])
    model = make_pipeline(pre, LogisticRegression(max_iter=2000, C=1.0))
    return model.fit(X[LOGIT_CATEGORICAL + LOGIT_NUMERIC], y)


def predict_logistic(model, X: pd.DataFrame) -> np.ndarray:
    return model.predict_proba(X[LOGIT_CATEGORICAL + LOGIT_NUMERIC])[:, 1]


def fit_xgb(X_train, y_train, X_valid=None, y_valid=None, n_estimators: int | None = None) -> xgb.XGBClassifier:
    """With a validation set: early-stop on it. Without: train for a fixed number of rounds."""
    params = dict(XGB_PARAMS)
    if X_valid is not None:
        model = xgb.XGBClassifier(**params, early_stopping_rounds=100)
        model.fit(X_train, y_train, eval_set=[(X_valid, y_valid)], verbose=False)
        return model
    params["n_estimators"] = int(n_estimators)
    return xgb.XGBClassifier(**params).fit(X_train, y_train, verbose=False)


def fit_isotonic(raw_prob: np.ndarray, y: np.ndarray) -> IsotonicRegression:
    return IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(raw_prob, y)
