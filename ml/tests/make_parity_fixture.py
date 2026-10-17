"""Regenerate the cross-architecture parity fixture from the current deployed model.

Run from ml/ after `python -m urban_sentinel.score --sample`:  python tests/make_parity_fixture.py
"""
import json
import shutil
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parents[1]))
from urban_sentinel.artifacts import CALIBRATION_FILE, META_FILE, MODEL_FILE, DeployedModel  # noqa: E402
from urban_sentinel.config import cycle_at  # noqa: E402
from urban_sentinel.featureset import Context, feature_matrix  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
sample = json.loads((Path(__file__).parents[1] / "contract" / "sample_buildings.json").read_text())["buildings"]
bins = pd.Index([r["bin"] for r in sample])
model = DeployedModel.load()
now = pd.Timestamp(sample[0]["prediction"]["scored_at"]).tz_localize(None).normalize()
X = feature_matrix(Context.load().restricted_to(bins), bins, now, cycle_at(now))[model.meta["features"]]
raw, prob, contrib = model.predict(X)
FIXTURES.mkdir(exist_ok=True)
shutil.copy(MODEL_FILE, FIXTURES / "parity_model.json")
shutil.copy(CALIBRATION_FILE, FIXTURES / "parity_calibration.json")
meta = json.loads(META_FILE.read_text())
(FIXTURES / "parity_cases.json").write_text(json.dumps({
    "features": meta["features"], "bins": list(bins), "X": X.astype(object).where(X.notna(), None).values.tolist(),
    "expected_raw": raw.tolist(), "expected_probability": prob.tolist(), "expected_contrib_sum": contrib.sum(1).tolist(),
    "generated_on": meta["trained_on"]["machine"], "model_sha256": meta["model_sha256"]}))
print("parity fixture:", len(bins), "cases, model", meta["model_sha256"])
