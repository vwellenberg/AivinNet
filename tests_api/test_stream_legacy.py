"""`GET /file/<trackhash>/legacy` is the only way audio leaves the server.

The transcoding route it once sat beside was commented out and its helpers had
no caller (AivinNet#180), so they were removed — and with them the `quality`
and `container` query fields, which only that route ever read. Two things must
survive that removal, and both only show up in a real request cycle:

* **The client still sends both fields.** `getUrl()` appends
  `&container=…&quality=…` to every stream URL. If the query model rejected
  unknown fields, every track would stop playing — so a request shaped exactly
  like the client's is pinned here.
* **Seeking needs `Range`.** The docs long claimed this endpoint has none. It
  does: `send_from_directory(..., conditional=True)` answers a byte range with
  206. That is what lets a browser jump into a long file without fetching the
  start, so it is pinned too instead of being believed either way.
"""

from pathlib import Path
from types import SimpleNamespace

import pytest

HASH = "0853280a12c4f9e1"  # 16 chars, like a real xxh3 trackhash — TrackHashSchema enforces it
PAYLOAD = bytes(range(256)) * 64  # 16 KiB, every byte value, so a slice is checkable


@pytest.fixture()
def stream(api_client, monkeypatch, tmp_path):
    import aivinnet.api.stream as stream_api

    root = tmp_path / "music"
    root.mkdir()
    track_file = root / "01 track.mp3"
    track_file.write_bytes(PAYLOAD)
    track = SimpleNamespace(filepath=str(track_file), trackhash=HASH, bitrate=320)

    monkeypatch.setattr(stream_api, "UserConfig", lambda: SimpleNamespace(rootDirs=[str(root)]))
    monkeypatch.setattr(
        stream_api.TrackStore,
        "get_tracks_by_filepaths",
        lambda paths: [track] if str(Path(paths[0])) == str(track_file) else [],
    )
    monkeypatch.setattr(stream_api.TrackStore, "trackhashmap", {HASH: SimpleNamespace(tracks=[track])})

    api = api_client("aivinnet.api.stream")
    return api, track_file


def _url(filepath, **extra):
    from urllib.parse import urlencode

    return f"/file/{HASH}/legacy?" + urlencode({"filepath": str(filepath), **extra})


def test_the_whole_file_is_sent_unchanged(stream):
    api, track_file = stream

    res = api.get(_url(track_file))

    assert res.status_code == 200
    assert res.data == PAYLOAD
    assert res.mimetype == "audio/mpeg"


def test_a_request_shaped_like_the_clients_still_plays(stream):
    """`client/src/stores/player.ts::getUrl` sends these on every track."""
    api, track_file = stream

    res = api.get(_url(track_file, container="mp3", quality="original"))

    assert res.status_code == 200
    assert res.data == PAYLOAD


def test_a_byte_range_is_answered_with_that_range(stream):
    api, track_file = stream

    res = api.get(_url(track_file), headers={"Range": "bytes=1000-1999"})

    assert res.status_code == 206
    assert res.headers["Content-Range"] == f"bytes 1000-1999/{len(PAYLOAD)}"
    assert res.data == PAYLOAD[1000:2000]


def test_an_unknown_path_falls_back_to_the_trackhash(stream):
    api, track_file = stream

    res = api.get(_url(track_file.parent / "moved away.mp3"))

    assert res.status_code == 200
    assert res.data == PAYLOAD


def test_a_path_now_held_by_another_track_falls_back_to_the_trackhash(api_client, monkeypatch, tmp_path):
    """Renaming a renumbered album frees and re-takes names (#144).

    A queue saved on another device still asks for this track under its OLD
    name — which now belongs to a different track. The hash still identifies
    the right file, so it must be looked up instead of answering 404 (or,
    worse, sending the other track).
    """
    import aivinnet.api.stream as stream_api

    root = tmp_path / "music"
    root.mkdir()
    ours = root / "04 - Ours.mp3"
    ours.write_bytes(PAYLOAD)
    theirs = root / "03 - Theirs.mp3"
    theirs.write_bytes(b"not this one")

    our_track = SimpleNamespace(filepath=str(ours), trackhash=HASH, bitrate=320)
    their_track = SimpleNamespace(filepath=str(theirs), trackhash="1111111111111111", bitrate=320)

    monkeypatch.setattr(stream_api, "UserConfig", lambda: SimpleNamespace(rootDirs=[str(root)]))
    monkeypatch.setattr(
        stream_api.TrackStore,
        "get_tracks_by_filepaths",
        lambda paths: [t for t in (our_track, their_track) if t.filepath in paths],
    )
    monkeypatch.setattr(
        stream_api.TrackStore,
        "trackhashmap",
        {HASH: SimpleNamespace(tracks=[our_track]), their_track.trackhash: SimpleNamespace(tracks=[their_track])},
    )
    api = api_client("aivinnet.api.stream")

    # Our track used to be "03 - Theirs.mp3".
    res = api.get(_url(theirs))

    assert res.status_code == 200
    assert res.data == PAYLOAD
