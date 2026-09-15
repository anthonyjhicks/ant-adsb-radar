"""PanelConfigStore — durable kiosk display preferences, kept in a JSON file.

The rotating views themselves live in the frontend, so this store deliberately
knows nothing about which panel ids exist: it validates the *shape* of the
config (unique, slug-like ids) and stores it verbatim. The kiosk reconciles the
saved config against its own registry when it loads, so views added or removed
in code need no change here and no migration of the file.

Three independent pieces, all optional:
  order   the rotation sequence; empty means "no preference, use the default"
  hidden  ids kept out of the rotation
  dwell   id -> milliseconds, overriding the registry's per-view dwell

They're deliberately not cross-checked — `hidden` may name an id absent from
`order` (an empty `order` still means the default sequence), and none of them
has to mention every view. Hiding is stored as an opt-out list rather than a
list of visible ids so that a view added in code later defaults to *visible*;
an allow-list would silently swallow every new view until someone re-saved.
`dwell` holds only the views actually changed, for the same reason: an unedited
view keeps following the default in the code, so changing a default there still
reaches every installation that never overrode it.

Writes are atomic (temp file + os.replace) so a crash mid-write can't leave a
truncated config behind, and reads are defensive — a missing or corrupt file
just means "no preference yet", which the kiosk renders as its default order.
"""

import json
import logging
import math
import os
import re
import tempfile
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# Panel ids are frontend slugs ("scope", "airspace3d", "newtoday"). Bounded so a
# misbehaving client can't turn the config into an arbitrary blob.
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
MAX_PANELS = 128

# Dwell bounds, in milliseconds. Short enough to be unreadable below the floor
# (and to thrash the crossfade), long enough above the ceiling that a kiosk
# would look stuck. Mirrored in frontend/src/lib/panels.ts — keep them in step.
MIN_DWELL_MS = 3_000
MAX_DWELL_MS = 600_000

EMPTY: dict = {"order": [], "hidden": [], "dwell": {}, "updated_at": None}


class InvalidOrder(ValueError):
    """A submitted id list isn't a list of unique, slug-like panel ids."""


def validate_ids(value: object, field: str = "order") -> list[str]:
    """Return `value` as a clean id list, or raise InvalidOrder."""
    if not isinstance(value, list):
        raise InvalidOrder(f"{field} must be a list of panel ids")
    if len(value) > MAX_PANELS:
        raise InvalidOrder(f"{field} must hold at most {MAX_PANELS} panel ids")
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str) or not _ID_RE.match(item):
            raise InvalidOrder(f"invalid panel id in {field}: {item!r}")
        if item in seen:
            raise InvalidOrder(f"duplicate panel id in {field}: {item!r}")
        seen.add(item)
    return list(value)


def validate_dwell(value: object) -> dict[str, int]:
    """Return `value` as a clean {panel id: milliseconds} map, or raise InvalidOrder."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise InvalidOrder("dwell must be an object of panel id -> milliseconds")
    if len(value) > MAX_PANELS:
        raise InvalidOrder(f"dwell must hold at most {MAX_PANELS} entries")
    out: dict[str, int] = {}
    for key, ms in value.items():
        if not isinstance(key, str) or not _ID_RE.match(key):
            raise InvalidOrder(f"invalid panel id in dwell: {key!r}")
        # bool is an int subclass, and json.loads happily produces NaN/Infinity,
        # so neither is caught by an isinstance check alone.
        if isinstance(ms, bool) or not isinstance(ms, (int, float)) or not math.isfinite(ms):
            raise InvalidOrder(f"dwell for {key!r} must be a number of milliseconds")
        if not MIN_DWELL_MS <= ms <= MAX_DWELL_MS:
            raise InvalidOrder(
                f"dwell for {key!r} must be between {MIN_DWELL_MS} and {MAX_DWELL_MS} ms"
            )
        out[key] = int(ms)
    return out


class PanelConfigStore:
    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self._lock = threading.Lock()
        # Raises if the directory can't be created; main.py treats that as
        # "no durable config" and the kiosk falls back to its default order.
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def get(self) -> dict:
        with self._lock:
            return self._read()

    def set_config(self, order: object, hidden: object = None, dwell: object = None) -> dict:
        payload = {
            "order": validate_ids(order, "order"),
            "hidden": validate_ids(hidden if hidden is not None else [], "hidden"),
            "dwell": validate_dwell(dwell),
            "updated_at": time.time(),
        }
        with self._lock:
            self._write(payload)
        return payload

    def _read(self) -> dict:
        try:
            raw = json.loads(self.path.read_text())
        except FileNotFoundError:
            return dict(EMPTY)
        except (OSError, ValueError) as exc:
            logger.warning("Panel config unreadable (%s) — falling back to defaults", exc)
            return dict(EMPTY)
        if not isinstance(raw, dict):
            logger.warning("Panel config malformed (not an object) — falling back to defaults")
            return dict(EMPTY)
        try:
            order = validate_ids(raw.get("order"), "order")
        except InvalidOrder as exc:
            logger.warning("Panel config malformed (%s) — falling back to defaults", exc)
            return dict(EMPTY)
        # A bad `hidden` shouldn't discard a perfectly good order — drop just
        # that half. Files written before hiding existed have no `hidden` key.
        try:
            hidden = validate_ids(raw.get("hidden", []), "hidden")
        except InvalidOrder as exc:
            logger.warning("Panel config `hidden` malformed (%s) — ignoring it", exc)
            hidden = []
        try:
            dwell = validate_dwell(raw.get("dwell"))
        except InvalidOrder as exc:
            logger.warning("Panel config `dwell` malformed (%s) — ignoring it", exc)
            dwell = {}
        updated = raw.get("updated_at")
        stamp = updated if isinstance(updated, (int, float)) else None
        return {"order": order, "hidden": hidden, "dwell": dwell, "updated_at": stamp}

    def _write(self, payload: dict) -> None:
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".panels-", suffix=".json")
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(payload, fh, indent=2)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
