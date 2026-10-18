import numpy as np
import pandas as pd
import pytest

from urban_sentinel.config import CYCLE_START, cycle_at, subcycle_deadline, subcycle_for_block
from urban_sentinel.evaluation import precision_recall_at_k
from urban_sentinel.features import LeakageError, assert_point_in_time, build_features
from urban_sentinel.labels import build_labels, never_filers

SEV = {"SAFE": 0, "SWARMP": 1, "UNSAFE": 2}


def row(bin_, cycle, ftype, status, observed, block="1234"):
    sub = subcycle_for_block(block)
    return {"bin": bin_, "cycle": cycle, "filing_type": ftype, "filing_status": status,
            "severity": SEV.get(status, np.nan), "is_nrf": status == "No Report Filed",
            "observed_on": pd.Timestamp(observed) if observed else pd.NaT, "subcycle": sub,
            "subcycle_deadline": subcycle_deadline(cycle, sub), "borough_code": 1,
            "exterior_wall_type_s_": "BRICK MASONRY", "exterior_wall_material_s_": None}


@pytest.fixture
def fac():
    return pd.DataFrame([
        row("1000001", 7, "Initial", "UNSAFE", "2011-05-01"),
        row("1000001", 7, "Amended", "SAFE", "2012-01-10"),          # repair certified
        row("1000001", 8, "Initial", "SWARMP", "2016-03-01"),
        row("1000001", 9, "Initial", "UNSAFE", "2021-06-01"),        # target-cycle outcome
        row("1000002", 8, "Initial", "SAFE", "2016-04-01"),
        row("1000002", 8, "Initial", "UNSAFE", "2016-04-02"),        # two filings: worst counts
        row("1000002", 9, "Initial", "SAFE", "2022-01-01"),
        row("1000003", 9, "Auto-Generated", "No Report Filed", None),
    ])


def test_subcycle_calendar():
    assert subcycle_for_block("1234") == "A" and subcycle_for_block(870) == "B" and subcycle_for_block("41") == "C"
    assert subcycle_deadline(9, "A") == pd.Timestamp("2022-02-21")
    assert subcycle_deadline(10, "C") == pd.Timestamp("2029-02-21")
    assert CYCLE_START[9] == pd.Timestamp("2020-02-21") and cycle_at(pd.Timestamp("2026-10-17")) == 10


def test_labels_take_worst_status_and_skip_never_filers(fac):
    lab = build_labels(fac, 8)
    assert lab.loc["1000002", "y"] == 1 and lab.loc["1000001", "y"] == 0
    assert "1000003" not in build_labels(fac, 9).index
    assert list(never_filers(fac, 9)) == ["1000003"]


def test_features_ignore_target_cycle_and_future_records(fac):
    bins = pd.Index(["1000001", "1000002"])
    X = build_features(fac, bins, CYCLE_START[9], 9)
    assert X.loc["1000001", "last_status"] == 1 and X.loc["1000001", "prev_status"] == 2
    assert X.loc["1000001", "n_unsafe"] == 1 and X.loc["1000002", "last_status"] == 2
    # Adding records dated after the cutoff (or in the target cycle) must not change any feature.
    future = pd.DataFrame([row("1000001", 8, "Subsequent", "SAFE", "2020-03-01"),
                           row("1000002", 9, "Initial", "UNSAFE", "2019-12-01")])
    X2 = build_features(pd.concat([fac, future], ignore_index=True), bins, CYCLE_START[9], 9)
    pd.testing.assert_frame_equal(X, X2)


def test_status_at_cutoff_reconstructs_repairs(fac):
    X = build_features(fac, pd.Index(["1000001"]), CYCLE_START[8], 8)
    assert X.loc["1000001", "last_status"] == 2 and X.loc["1000001", "status_at_cutoff"] == 0
    assert X.loc["1000001", "repaired_since_last"] == 1


def test_guard_raises_on_post_cutoff_record(fac):
    with pytest.raises(LeakageError):
        assert_point_in_time(fac, CYCLE_START[9], 10)


def test_precision_at_k_is_deterministic_under_ties():
    y = np.array([1, 0, 1, 0])
    assert precision_recall_at_k(y, np.array([1.0, 1.0, 1.0, 0.0]), 2) == (0.5, 0.5)
