"""Cross-architecture parity (run on LinuxONE: big-endian s390x) and frontend-contract checks."""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

from urban_sentinel.models import PlattCalibrator

FIXTURES = Path(__file__).parent / "fixtures"
CONTRACT = Path(__file__).parents[1] / "contract"


def test_model_predictions_match_reference_architecture():
    cases = json.loads((FIXTURES / "parity_cases.json").read_text())
    booster = xgb.Booster()
    booster.load_model(str(FIXTURES / "parity_model.json"))
    X = pd.DataFrame(cases["X"], columns=cases["features"], dtype=float)
    dm = xgb.DMatrix(X)
    raw = booster.predict(dm)
    prob = PlattCalibrator.from_json(json.loads((FIXTURES / "parity_calibration.json").read_text())).predict(raw)
    contrib_sum = booster.predict(dm, pred_contribs=True)[:, :-1].sum(1)
    print(f"parity on {sys.byteorder}-endian vs fixture from {cases['generated_on']}")
    np.testing.assert_allclose(raw, cases["expected_raw"], rtol=0, atol=1e-6)
    np.testing.assert_allclose(prob, cases["expected_probability"], rtol=0, atol=1e-6)
    np.testing.assert_allclose(contrib_sum, cases["expected_contrib_sum"], rtol=0, atol=1e-5)


def test_sample_matches_contract_schema():
    schema = json.loads((CONTRACT / "building_score.schema.json").read_text())
    sample = json.loads((CONTRACT / "sample_buildings.json").read_text())
    required = schema["required"]
    pred_required = schema["properties"]["prediction"]["anyOf"][0]["required"]
    tiers = set(schema["properties"]["prediction"]["anyOf"][0]["properties"]["tier"]["enum"])
    assert len(sample["buildings"]) <= 20
    for rec in sample["buildings"]:
        assert all(k in rec for k in required), rec["bin"]
        assert len(rec["bin"]) == 7 and rec["bin"].isdigit()
        if rec["prediction"] is not None:
            p = rec["prediction"]
            assert all(k in p for k in pred_required) and p["tier"] in tiers and 0 <= p["probability"] <= 1
            assert not rec["fisp"]["current_cycle_filed"]
            assert 1 <= len(rec["drivers"]) <= 3
        else:
            assert rec["fisp"]["current_cycle_filed"]
