"""A library with music folders but no tracks is scanned once at startup.

Nothing else scans on its own, so the folder `install.sh --music` writes before
the first start was never read: a fresh install came up empty. Found by
installing the release candidate in a clean container.
"""

from types import SimpleNamespace

import pytest

import aivinnet.lib.index as index


@pytest.fixture()
def scans(monkeypatch):
    calls = []
    monkeypatch.setattr(index, "index_everything", lambda: calls.append(1))
    return calls


def _setup(monkeypatch, root_dirs, tracks):
    monkeypatch.setattr(index, "UserConfig", lambda: SimpleNamespace(rootDirs=root_dirs))
    monkeypatch.setattr(index.TrackStore, "get_flat_list", classmethod(lambda cls: list(tracks)))


def test_folders_but_no_tracks_scans_once(monkeypatch, scans):
    _setup(monkeypatch, ["/music"], [])

    assert index.index_if_never_scanned() is True
    assert scans == [1]


def test_a_library_with_tracks_is_left_alone(monkeypatch, scans):
    _setup(monkeypatch, ["/music"], [object()])

    assert index.index_if_never_scanned() is False
    assert scans == []


def test_no_folders_means_nothing_to_scan(monkeypatch, scans):
    _setup(monkeypatch, [], [])

    assert index.index_if_never_scanned() is False
    assert scans == []
