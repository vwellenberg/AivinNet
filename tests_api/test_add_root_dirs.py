"""Adding a music folder replaces only the folders that are really inside it (#391).

`get_child_dirs` asked `startswith` on the plain strings, so adding `/mnt/music`
took `/mnt/music-flac` for a subfolder of it and dropped it from the settings.
That root vanished from the Folders page, and since a rescan now drops the rows
of a folder that is no longer in the library, its tracks would go with it.
"""

from types import SimpleNamespace

import pytest


@pytest.fixture()
def settings_api(api_client, monkeypatch):
    import aivinnet.api.settings as settings_api

    monkeypatch.setattr("aivinnet.api.auth.current_user", {"roles": ["admin"]})
    monkeypatch.setattr(settings_api, "index_everything", lambda: None)
    config = SimpleNamespace(rootDirs=[])
    monkeypatch.setattr(settings_api, "UserConfig", lambda: config)
    return api_client("aivinnet.api.settings"), config


def test_a_sibling_with_the_same_prefix_stays(settings_api):
    api, config = settings_api
    config.rootDirs = ["/mnt/music-flac"]

    res = api.post("/notsettings/add-root-dirs", json={"new_dirs": ["/mnt/music"], "removed": []})

    assert res.status_code == 200
    assert sorted(res.get_json()["root_dirs"]) == ["/mnt/music", "/mnt/music-flac"]


def test_a_real_subfolder_is_still_replaced_by_its_parent(settings_api):
    api, config = settings_api
    config.rootDirs = ["/mnt/music/flac", "/srv/audio"]

    res = api.post("/notsettings/add-root-dirs", json={"new_dirs": ["/mnt/music/"], "removed": []})

    assert res.status_code == 200
    assert sorted(res.get_json()["root_dirs"]) == ["/mnt/music/", "/srv/audio"]


def test_the_same_folder_spelled_with_a_trailing_slash_is_replaced(settings_api):
    """Otherwise both stay, and every scan walks the same tree twice."""
    api, config = settings_api
    config.rootDirs = ["/mnt/music/"]

    res = api.post("/notsettings/add-root-dirs", json={"new_dirs": ["/mnt/music"], "removed": []})

    assert res.status_code == 200
    assert res.get_json()["root_dirs"] == ["/mnt/music"]
