"""FLAC with an ID3v2 tag in front of `fLaC`, through the real stream endpoint.

Firefox refuses such a file outright ("could not be decoded",
NS_ERROR_DOM_MEDIA_METADATA_ERR); Chrome, Edge and Safari skip the tag and
play. A tester's whole FLAC library would not play in Firefox. The endpoint
now sends the file from the `fLaC` marker on — and seeking (Range) has to keep
working on that shifted view, or every jump inside a track breaks.
"""

from types import SimpleNamespace

import pytest

HASH = "0853280a12c4f9e1"
AUDIO = b"fLaC" + bytes(range(256)) * 64  # the FLAC stream as Firefox must see it


def id3_tag(payload_size: int) -> bytes:
    syncsafe = bytes(((payload_size >> s) & 0x7F) for s in (21, 14, 7, 0))
    return b"ID3\x03\x00\x00" + syncsafe + b"\x00" * payload_size


@pytest.fixture()
def stream(api_client, monkeypatch, tmp_path):
    import aivinnet.api.stream as stream_api

    root = tmp_path / "music"
    root.mkdir()
    # The handler finds a track by its hash in the store, then by its path.
    monkeypatch.setattr(stream_api.TrackStore, "trackhashmap", {})

    def track_file(name: str, data: bytes):
        path = root / name
        path.write_bytes(data)
        stream_api.TrackStore.add_track(SimpleNamespace(filepath=str(path), trackhash=HASH, bitrate=1000))
        return path

    monkeypatch.setattr(stream_api, "UserConfig", lambda: SimpleNamespace(rootDirs=[str(root)]))

    return api_client("aivinnet.api.stream"), track_file


def _url(filepath):
    from urllib.parse import urlencode

    return f"/file/{HASH}/legacy?" + urlencode({"filepath": str(filepath)})


def test_the_tag_is_left_out(stream):
    api, track_file = stream
    path = track_file("tagged.flac", id3_tag(4000) + AUDIO)

    res = api.get(_url(path))

    assert res.status_code == 200
    assert res.mimetype == "audio/flac"
    assert res.data == AUDIO
    assert res.headers["Content-Length"] == str(len(AUDIO))
    assert res.headers["Accept-Ranges"] == "bytes"
    # The file on disk is untouched.
    assert path.read_bytes()[:3] == b"ID3"


def test_a_range_is_counted_from_the_flac_marker(stream):
    api, track_file = stream
    path = track_file("tagged.flac", id3_tag(4000) + AUDIO)

    head = api.get(_url(path), headers={"Range": "bytes=0-3"})
    middle = api.get(_url(path), headers={"Range": "bytes=1000-1999"})
    tail = api.get(_url(path), headers={"Range": "bytes=-10"})

    assert head.status_code == 206
    assert head.data == b"fLaC"
    assert head.headers["Content-Range"] == f"bytes 0-3/{len(AUDIO)}"
    assert middle.data == AUDIO[1000:2000]
    assert tail.data == AUDIO[-10:]


def test_a_range_past_the_end_is_416(stream):
    api, track_file = stream
    path = track_file("tagged.flac", id3_tag(10) + AUDIO)

    res = api.get(_url(path), headers={"Range": f"bytes={len(AUDIO) + 5}-"})

    assert res.status_code == 416


def test_a_clean_flac_is_sent_as_it_is(stream):
    api, track_file = stream
    path = track_file("clean.flac", AUDIO)

    res = api.get(_url(path))

    assert res.data == AUDIO


def test_an_mp3_with_id3_keeps_its_tag(stream):
    # ID3 belongs to MP3; only FLAC is cut.
    api, track_file = stream
    data = id3_tag(100) + b"\xff\xfb" + b"\x00" * 500
    path = track_file("song.mp3", data)

    res = api.get(_url(path))

    assert res.data == data
