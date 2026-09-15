"""Decoding of the raw METAR body + active-runway / wind-component maths."""

from app.routers.metar import (
    _active_runways,
    _runway_winds,
    build_metar,
    parse_clouds,
    parse_visibility,
    parse_weather,
    parse_wind_variation,
)

LHR_RAIN = (
    "METAR EGLL 091020Z AUTO 24012G22KT 210V270 4000 -SHRA BKN012 OVC025CB 14/12 Q0998"
    " TEMPO 2000 +TSRA"
)
LHR_FAIR = "METAR EGLL 010720Z AUTO 28008KT 250V330 9999 FEW018 19/13 Q1023"
LCY_FOG = "METAR EGLC 050650Z 00000KT 0300 R09/0550N FZFG VV001 M02/M02 Q1031"
CAVOK = "METAR EGSS 121250Z 05006KT CAVOK 22/10 Q1019 NOSIG"
VRB = "METAR EGKK 121250Z VRB03KT 8000 BR NSC 11/10 Q1005"
US = "METAR KJFK 121251Z 18010KT 2 1/2SM -RA BR OVC008 12/11 A2992 RMK AO2"


def test_weather_groups_decode_with_labels():
    wx = parse_weather(LHR_RAIN)
    assert [w["code"] for w in wx] == ["-SHRA"]  # the TEMPO group is not present weather
    assert wx[0]["intensity"] == "light"
    assert wx[0]["descriptor"] == "SH"
    assert wx[0]["precip"] == ["RA"]
    assert wx[0]["label"] == "light rain showers"

    fog = parse_weather(LCY_FOG)
    assert fog[0]["code"] == "FZFG"
    assert fog[0]["obscuration"] == "FG"
    assert fog[0]["label"] == "freezing fog"

    assert parse_weather("EGLL 1200Z 27010KT 9999 VCTS SCT030CB 20/12 Q1010")[0]["label"] == (
        "thunderstorm in the vicinity"
    )
    assert parse_weather("EGLL 1200Z 27010KT 9999 +TSRAGR SCT030CB 20/12 Q1010")[0]["label"] == (
        "heavy thunderstorm with rain and hail"
    )
    assert parse_weather("EGLL 1200Z 27010KT 9999 -RASN OVC010 01/00 Q1010")[0]["label"] == (
        "light rain and snow"
    )
    assert parse_weather(VRB)[0]["label"] == "mist"
    assert parse_weather(LHR_FAIR) == []
    assert parse_weather(None) == []


def test_weather_ignores_lookalike_tokens():
    # Station ids, runway state and "recent" groups must not decode as weather.
    raw = "METAR EGSS 121250Z 05006KT 9999 RERA R22/19//95 SCT030 22/10 Q1019"
    assert [w["code"] for w in parse_weather(raw)] == []


def test_visibility_in_metres():
    assert parse_visibility(LHR_RAIN) == {"visibility_m": 4000, "cavok": False}
    assert parse_visibility(LHR_FAIR) == {"visibility_m": 10000, "cavok": False}
    assert parse_visibility(LCY_FOG) == {"visibility_m": 300, "cavok": False}
    assert parse_visibility(CAVOK) == {"visibility_m": 10000, "cavok": True}
    assert parse_visibility(VRB) == {"visibility_m": 8000, "cavok": False}
    # Statute miles (US) convert; the time group never reads as visibility.
    assert parse_visibility(US)["visibility_m"] == round(2.5 * 1609.344)
    half = "KJFK 121251Z 18010KT 1/2SM FG VV002 12/11 A2992"
    assert parse_visibility(half)["visibility_m"] == 805
    ten = "KJFK 121251Z 18010KT 10SM CLR 12/11 A2992"
    assert parse_visibility(ten)["visibility_m"] == 16093
    assert parse_visibility("METAR EGLL 091020Z 24012KT BKN012 14/12 Q0998") == {
        "visibility_m": None,
        "cavok": False,
    }
    # Wind group missing altogether: the visibility still decodes.
    assert parse_visibility("METAR EGLL 091020Z /////KT 6000 BKN012 14/12 Q0998") == {
        "visibility_m": 6000,
        "cavok": False,
    }


def test_cloud_layers_ceiling_and_sky():
    c = parse_clouds(LHR_RAIN)
    assert [(layer["cover"], layer["base_ft"], layer["type"]) for layer in c["cloud_layers"]] == [
        ("BKN", 1200, None),
        ("OVC", 2500, "CB"),
    ]
    assert c["ceiling_ft"] == 1200
    assert c["sky"] == "overcast"

    fair = parse_clouds(LHR_FAIR)
    assert fair["ceiling_ft"] is None
    assert fair["sky"] == "few"

    assert parse_clouds(LCY_FOG)["sky"] == "obscured"
    assert parse_clouds(LCY_FOG)["ceiling_ft"] == 100
    assert parse_clouds(CAVOK) == {"cloud_layers": [], "ceiling_ft": None, "sky": "cavok"}
    assert parse_clouds(VRB)["sky"] == "clear"


def test_wind_variation():
    assert parse_wind_variation(LHR_FAIR) == {"var_from": 250, "var_to": 330}
    assert parse_wind_variation(CAVOK) == {"var_from": None, "var_to": None}


def test_active_runways_follow_the_wind():
    assert _active_runways("EGLL", 280, 8) == {"runways": ["27L", "27R"], "mode": "Westerly"}
    assert _active_runways("EGLL", 70, 12) == {"runways": ["09L", "09R"], "mode": "Easterly"}
    # Calm → the airport's preferred direction.
    assert _active_runways("EGLL", 0, 0) == {"runways": ["27L", "27R"], "mode": "Westerly (calm)"}
    assert _active_runways("EGSS", 40, 15) == {"runways": ["04"], "mode": "Northerly"}
    # Battersea heliport: the FATO end facing the wind.
    assert _active_runways("EGLW", 240, 8) == {"runways": ["22"], "mode": "Southerly"}
    assert _active_runways("EGLW", 60, 8) == {"runways": ["04"], "mode": "Northerly"}
    assert _active_runways("ZZZZ", 40, 15) == {"runways": [], "mode": None}


def test_runway_wind_components():
    winds = {w["name"]: w for w in _runway_winds("EGLL", 240, 12, ["27L", "27R"])}
    # Wind 30° left of runway 27: ~10 kt headwind, ~6 kt crosswind from the left.
    assert winds["27L"]["active"] is True
    assert winds["27L"]["headwind"] == 10
    assert winds["27L"]["crosswind"] == 6
    assert winds["27L"]["crosswind_from"] == "L"
    # Reciprocal end sees the same as a tailwind, crosswind from the right.
    assert winds["09L"]["active"] is False
    assert winds["09L"]["headwind"] == -10
    assert winds["09L"]["crosswind_from"] == "R"

    calm = _runway_winds("EGLC", 0, 0, ["27"])
    assert all(w["headwind"] == 0 and w["crosswind"] == 0 for w in calm)
    variable = _runway_winds("EGLC", None, 3, ["27"])
    assert all(w["headwind"] is None and w["crosswind"] is None for w in variable)


def test_build_metar_document():
    rec = {
        "icaoId": "EGLL",
        "rawOb": LHR_RAIN,
        "obsTime": 1_789_000_000,
        "wdir": 240,
        "wspd": 12,
        "wgst": 22,
        "temp": 14,
        "dewp": 12,
        "visib": "2.5",
        "altim": 998,
        "fltCat": "MVFR",
        "wxString": "-SHRA",
        "clouds": [{"cover": "BKN", "base": 1200}, {"cover": "OVC", "base": 2500}],
    }
    doc = build_metar("EGLL", rec)
    assert doc["available"] is True
    assert doc["name"] == "Heathrow"
    assert doc["lat"] == 51.4775 and doc["lon"] == -0.4614
    assert doc["obs_time"] == "2026-09-10T00:26:40Z"
    assert doc["wind"] == {
        "dir": 240,
        "speed": 12,
        "gust": 22,
        "variable": False,
        "var_from": 210,
        "var_to": 270,
    }
    assert doc["visibility_m"] == 4000
    assert doc["ceiling_ft"] == 1200
    assert doc["weather"][0]["label"] == "light rain showers"
    assert doc["runways"] == ["27L", "27R"]
    assert {w["name"] for w in doc["runway_winds"] if w["active"]} == {"27L", "27R"}

    missing = build_metar("EGKK", None)
    assert missing == {
        "icao": "EGKK",
        "available": False,
        "name": "Gatwick",
        "lat": 51.1481,
        "lon": -0.1903,
        "elev_ft": 203,
    }
