import json

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from urban_sentinel import history
from urban_sentinel.history import MovementStore, build_history, valid_bin


def filing(bin_, cycle, ftype, status, filed, inspected=None, tr6="TR6-1"):
    return {"tr6_no": tr6, "bin": bin_, "cycle": cycle, "filing_type": ftype, "filing_status": status,
            "filing_date": pd.Timestamp(filed) if filed else pd.NaT, "submitted_on": pd.NaT,
            "field_inspection_completed_date": pd.Timestamp(inspected) if inspected else pd.NaT,
            "exterior_wall_type_s_": "BRICK MASONRY", "exterior_wall_material_s_": None,
            "subcycle_deadline": pd.Timestamp("2025-02-21"), "house_no": "120", "street_name": "BROADWAY",
            "borough": "Manhattan"}


@pytest.fixture
def fac():
    return pd.DataFrame([
        filing("1001234", 8, "Initial", "UNSAFE", "2016-03-01", inspected="2016-01-15", tr6="TR6-A"),
        filing("1001234", 9, "Initial", "SWARMP", "2021-06-01", tr6="TR6-B"),
        filing("1001234", 9, "Auto-Generated", "No Report Filed", None, tr6="TR6-C"),
        filing("2000001", 9, "Initial", "SAFE", "2022-01-01"),
    ])


@pytest.fixture
def events():
    return {
        "dob": pd.DataFrame({"bin": ["1001234"], "date": [pd.Timestamp("2018-05-02")], "group": ["facade"]}),
        "ecb": pd.DataFrame({"bin": ["1001234", "9999999"], "date": pd.to_datetime(["2019-07-01", "2019-07-01"]),
                             "group": ["shed", "wall"]}),
        "cmp": pd.DataFrame({"bin": ["1009999"], "date": [pd.Timestamp("2020-01-01")], "group": ["debris"]}),
    }


@pytest.fixture
def movement():
    disp = np.array([[0.0, -1.0, np.nan, -3.0]], np.float32)
    base = np.array([[0.0, -0.5, -0.8, np.nan]], np.float32)
    return MovementStore({"1001234": 0}, ["2016-07-16", "2016-09-26", "2016-10-08", "2016-10-20"],
                         disp, base, np.array([-1.25], np.float32), {"baseline_label": "Neighbourhood (~2 km)"})


def test_valid_bin():
    assert valid_bin("1001234") and valid_bin("5123456")
    assert not valid_bin("1000000")       # DOB placeholder
    assert not valid_bin("6123456") and not valid_bin("123") and not valid_bin("10012345")


def test_history_merges_and_orders_records(fac, events, movement, tmp_path):
    rec = {"bin": "1001234", "address": "120 BROADWAY", "borough": "Manhattan", "lat": 40.7, "lon": -74.0,
           "prediction": None}
    h = build_history("1001234", fac, events, {"1001234": rec}, movement, raw_dir=tmp_path)
    assert h["in_fisp_universe"] and h["record"] is rec and h["address"] == "120 BROADWAY"
    dates = [r["date"] for r in h["records"]]
    assert dates == sorted(dates, reverse=True)
    # Auto-generated NRF rows have no filing date: dated at the sub-cycle deadline
    assert h["records"][0] == {**h["records"][0], "date": "2025-02-21", "type": "FISP filing"}
    assert h["record_counts"] == {"FISP filing": 3, "DOB violation": 1, "ECB violation": 1}
    first = next(r for r in h["records"] if r.get("reference") == "TR6-A")
    assert "Cycle 8 initial: UNSAFE" in first["description"] and "inspected 2016-01-15" in first["description"]
    ecb = next(r for r in h["records"] if r["type"] == "ECB violation")
    assert ecb["description"] == "Sidewalk shed or pedestrian protection"   # other BINs' events excluded


def test_movement_skips_missing_epochs(fac, events, movement, tmp_path):
    m = build_history("1001234", fac, events, {}, movement, raw_dir=tmp_path)["movement"]
    assert [p["date"] for p in m["series"]] == ["2016-07-16", "2016-09-26", "2016-10-20"]
    assert m["series"][-1]["baseline_mm"] is None and m["velocity_hp2km_mm_yr"] == -1.25
    assert m["meta"]["baseline_label"] == "Neighbourhood (~2 km)"


def test_non_fisp_building_and_missing_movement(fac, events, tmp_path):
    h = build_history("1009999", fac, events, {}, None, raw_dir=tmp_path)
    assert not h["in_fisp_universe"] and h["record"] is None and h["movement"] is None
    assert [r["type"] for r in h["records"]] == ["311 complaint"]
    assert h["records"][0]["description"] == "Debris falling or in danger of falling"


def test_unscored_fisp_building_falls_back_to_filing_address(fac, events, tmp_path):
    h = build_history("2000001", fac, events, {}, None, raw_dir=tmp_path)
    assert h["in_fisp_universe"] and h["address"] == "120 BROADWAY" and h["lat"] is None


def test_sources_read_raw_meta(fac, events, tmp_path):
    (tmp_path / "facades.meta.json").write_text(json.dumps(
        {"dataset_id": "xubg-57si", "rows_updated_at": "2026-10-16T17:31:17+00:00"}))
    h = build_history("1001234", fac, events, {}, None, raw_dir=tmp_path)
    assert h["sources"] == [{"name": "FISP filings (xubg-57si)", "observed_at": "2026-10-16"}]


def test_movement_store_round_trip(tmp_path):
    npz, meta = tmp_path / "m.npz", tmp_path / "m.json"
    np.savez_compressed(npz, bins=np.array([1001234]), dates=np.array(["2016-07-16", "2016-09-26"]),
                        disp=np.array([[0.0, -2.0]], np.float32), base=np.array([[0.0, -1.0]], np.float32),
                        vel_hp=np.array([-0.5], np.float32))
    meta.write_text(json.dumps({"source": "OPERA DISP-S1"}))
    store = MovementStore.load(npz, meta)
    assert store.series("1001234")["series"][1] == {"date": "2016-09-26", "displacement_mm": -2.0, "baseline_mm": -1.0}
    assert store.series("1000001") is None and store.meta["source"] == "OPERA DISP-S1"
    assert MovementStore.load(tmp_path / "absent.npz") is None


def test_endpoint_validates_bin(fac, events, monkeypatch, tmp_path):
    monkeypatch.setattr(history, "MOVEMENT_FILE", tmp_path / "absent.npz")
    state = type("S", (), {"ctx": type("C", (), {"fac": fac, "events": events})(), "buildings": {}})()
    app = FastAPI()
    app.include_router(history.build_router(lambda: state))
    client = TestClient(app)
    assert client.get("/buildings/1000000/history").status_code == 422
    assert client.get("/buildings/abc/history").status_code == 422
    r = client.get("/buildings/1001234/history")
    assert r.status_code == 200 and r.json()["record_counts"]["FISP filing"] == 3 and r.json()["movement"] is None
