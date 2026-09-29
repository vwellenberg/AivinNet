"""Two ways a failure used to destroy the only good copy of something."""

import json
from types import SimpleNamespace

import pytest


def test_a_leftover_backup_is_never_overwritten(tmp_path):
    """A .bak still present is the leftover of a failed restore or a crash
    mid-write, maybe the only intact copy of the audio. The next edit copied the
    damaged file over it."""
    from aivinnet.lib import track_edit

    song = tmp_path / "song.mp3"
    song.write_bytes(b"damaged")
    backup = tmp_path / "song.mp3.bak"
    backup.write_bytes(b"the original")
    old = SimpleNamespace(
        trackhash="0853280a12c4f9e1",
        filepath=str(song),
        albumhash="al",
        artisthashes=[],
        albumartists=[],
        artists=[],
    )

    with pytest.raises(track_edit.TrackEditError, match="backup"):
        track_edit._edit(old, {"title": "New"})

    assert backup.read_bytes() == b"the original"


def _writer(path):
    from aivinnet.config import UserConfig

    return lambda settings: UserConfig.write_to_file(SimpleNamespace(_config_path=path), settings)


def test_settings_are_swapped_in_whole(tmp_path):
    path = tmp_path / "settings.json"
    _writer(path)({"serverId": "abc", "rootDirs": ["/m"], "_internal": 1})

    assert json.loads(path.read_text()) == {"serverId": "abc", "rootDirs": ["/m"]}
    assert not (tmp_path / "settings.json.tmp").exists()


def test_a_write_cut_short_leaves_the_old_settings_intact(tmp_path, monkeypatch):
    """Rewritten in place, a write that died halfway left a torn file, and the
    obvious repair (deleting it) regenerated serverId: every password invalid."""
    import aivinnet.config as config

    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"serverId": "keep-me"}))

    def dies_halfway(obj, f, **kwargs):
        f.write('{"serverId": "tor')
        raise OSError("disk full")

    monkeypatch.setattr(config.json, "dump", dies_halfway)

    with pytest.raises(OSError):
        _writer(path)({"serverId": "new"})

    assert json.loads(path.read_text()) == {"serverId": "keep-me"}
    assert not (tmp_path / "settings.json.tmp").exists()
