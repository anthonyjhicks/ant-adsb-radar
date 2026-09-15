"""Station settings: validation, defaults, and the on-disk round trip."""

import json

import pytest

from app.services.readsb import _haversine_nm
from app.services.station_config import (
    DEFAULTS,
    InvalidStation,
    StationConfigStore,
    validate_station,
)


def test_defaults_are_private_by_default():
    assert DEFAULTS["show_coords"] is False
    assert DEFAULTS["lat"] is None and DEFAULTS["lon"] is None


def test_validate_keeps_only_what_was_sent():
    assert validate_station({}) == {}
    assert validate_station({"name": "  Roof   Radar "}) == {"name": "Roof Radar"}
    out = validate_station({"lat": 51.5, "lon": -0.1, "metar_stations": [" egll", "egkk"]})
    assert out == {"lat": 51.5, "lon": -0.1, "metar_stations": ["EGLL", "EGKK"]}


@pytest.mark.parametrize(
    "bad",
    [
        {"name": ""},
        {"name": "x" * 41},
        {"name": 3},
        {"lat": 51.5},  # lon missing
        {"lat": 91, "lon": 0},
        {"lat": 0, "lon": -181},
        {"lat": float("nan"), "lon": 0},
        {"lat": True, "lon": 0},
        {"show_coords": "yes"},
        {"local_nm": 4},
        {"local_nm": 241},
        {"home_nm": 1},
        {"local_label": "x" * 33},
        {"metar_stations": "EGLL"},
        {"metar_stations": ["EGLL", "EGLL"]},
        {"metar_stations": ["EGL"]},
        {"metar_stations": ["EGLL", "EGKK", "EGSS", "EGLC", "EGGW"]},
        [],
    ],
)
def test_validate_rejects(bad):
    with pytest.raises(InvalidStation):
        validate_station(bad)


def test_store_round_trip_fills_defaults(tmp_path):
    store = StationConfigStore(str(tmp_path / "cfg" / "station.json"))
    doc = store.get()
    assert doc["name"] == DEFAULTS["name"]
    assert doc["updated_at"] is None
    assert store.location() is None

    saved = store.set_config({"name": "Roof", "lat": 51.5, "lon": -0.12, "home_nm": 8})
    assert saved["name"] == "Roof"
    assert saved["home_nm"] == 8
    assert saved["local_nm"] == DEFAULTS["local_nm"]  # untouched -> default
    assert saved["updated_at"] is not None
    assert store.location() == (51.5, -0.12)

    # Only the saved keys hit the disk.
    on_disk = json.loads((tmp_path / "cfg" / "station.json").read_text())
    assert set(on_disk) == {"name", "lat", "lon", "home_nm", "updated_at"}

    # Clearing the location goes back to readsb's.
    store.set_config({"name": "Roof"})
    assert store.location() is None


def test_store_reads_hand_edits_and_drops_bad_keys(tmp_path):
    path = tmp_path / "station.json"
    store = StationConfigStore(str(path))
    path.write_text(json.dumps({"name": "Hand", "local_nm": 9999, "lat": 10, "lon": 20}))
    doc = store.get()
    assert doc["name"] == "Hand"
    assert doc["local_nm"] == DEFAULTS["local_nm"]  # out of range -> ignored
    assert store.location() == (10.0, 20.0)

    path.write_text("not json")
    assert store.get()["name"] == DEFAULTS["name"]


def test_haversine():
    # Heathrow -> Gatwick is a little under 22 nm.
    assert 21 < _haversine_nm(51.4775, -0.4614, 51.1481, -0.1903) < 23
    assert _haversine_nm(0, 0, 0, 0) == 0
