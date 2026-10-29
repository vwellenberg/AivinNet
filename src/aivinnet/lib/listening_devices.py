"""
Listening per device on the stats page (#541): the share of the time listened
that each of the user's devices played.

A play carries the id of the device that sent it, in `scrobble.extra["device_id"]`
(from #541 on). `ScrobbleTable.seconds_by_device_in_period` sums the seconds per
id in SQL; this names them from the device registry and shares them out.

Pure rules, free of database and store imports like `lib/listening_clock.py`,
so the fast lane can test them.
"""

from collections.abc import Iterable, Mapping
from typing import Any

# What a row of the answer is: a registered device, an id the registry does
# not know (a device since deleted), or plays from before devices were recorded.
DEVICE = "device"
OTHER = "other"
NONE = "none"

_KIND_ORDER = {DEVICE: 0, OTHER: 1, NONE: 2}


def build_devices(
    rows: Iterable[tuple[str | None, int | None]],
    registry: Mapping[str, str],
) -> dict[str, Any]:
    """
    The `GET /logger/devices` payload: the total seconds and each device's
    seconds and share of it, the largest first.

    `rows` are `(device id or None, seconds listened)`, one per id, though
    repeated ids are added up. `registry` maps the user's device ids to their
    names. An id not in it is "other device" (all such ids in one row); a play
    without an id is "no device recorded". Nothing is listed for a period
    without music.
    """
    seconds: dict[tuple[str, str | None], int] = {}

    for device_id, listened in rows:
        amount = int(listened or 0)
        if amount <= 0:
            continue

        key: tuple[str, str | None]
        if device_id is None:
            key = (NONE, None)
        elif device_id in registry:
            key = (DEVICE, device_id)
        else:
            key = (OTHER, None)

        seconds[key] = seconds.get(key, 0) + amount

    total = sum(seconds.values())

    devices: list[dict[str, Any]] = [
        {
            "device_id": device_id,
            "name": registry[device_id] if kind == DEVICE and device_id is not None else "",
            "kind": kind,
            "seconds": amount,
            "share": round(amount / total, 4),
        }
        for (kind, device_id), amount in seconds.items()
    ]
    # Largest first; a tie goes to the registered name, then the kind's order.
    devices.sort(key=lambda row: (-row["seconds"], _KIND_ORDER[row["kind"]], row["name"]))

    return {"total": total, "devices": devices}
