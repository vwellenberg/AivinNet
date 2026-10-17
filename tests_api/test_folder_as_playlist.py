"""POST /playlists/save-item for a folder saves what "Play" on it plays.

"Play" on a folder card (`/folder/tracks/all`) looks the folder up under
`dir_prefix`: resolved like the scanner resolves, POSIX, one trailing `/`.
"Save as playlist" (`TrackStore.get_tracks_in_path`) compared the folder as
the client sent it. The scanner stores RESOLVED paths, so the root folder card
of a library reached through a symlink played its tracks and answered "No
tracks founds" when saved as a playlist.
"""

import os

import pytest


def _track(n: int, filepath: str):
    from aivinnet.config import UserConfig
    from aivinnet.models.track import Track

    return Track(
        id=n,
        album="Album",
        albumartists="Band",
        albumhash="63e329a1b0641f44",
        artists="Band",
        bitrate=256,
        copyright="",
        date=0,
        disc=1,
        duration=180,
        filepath=filepath,
        # As `taglib` stores it: `filepath.parent.as_posix()`.
        folder=filepath.rsplit("/", 1)[0],
        genres="",
        last_mod=n,
        title=f"Song {n}",
        track=n,
        trackhash=f"th{n}",
        extra={},
        lastplayed=0,
        playcount=0,
        playduration=0,
        config=UserConfig(),
    )


@pytest.fixture()
def library(monkeypatch):
    from aivinnet.store.albums import AlbumStore
    from aivinnet.store.tracks import TrackStore

    monkeypatch.setattr(TrackStore, "trackhashmap", {})
    monkeypatch.setattr(TrackStore, "_by_filepath", {})
    monkeypatch.setattr(AlbumStore, "albummap", {})

    def add(*filepaths: str) -> list[str]:
        hashes = []
        for filepath in filepaths:
            track = _track(len(TrackStore.trackhashmap) + 1, filepath)
            TrackStore.add_track(track)
            hashes.append(track.trackhash)
        return hashes

    return add


def _save_folder(api_client, path: str) -> list[str]:
    from aivinnet.db.userdata import PlaylistTable

    res = api_client("aivinnet.api.playlist").post(
        "/playlists/save-item",
        json={"itemtype": "folder", "itemhash": path, "playlist_name": "From a folder"},
    )
    assert res.status_code == 201, res.get_data(as_text=True)

    saved = next(p for p in PlaylistTable.get_all() if p.name == "From a folder")
    return sorted(saved.trackhashes)


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_a_root_reached_through_a_symlink_saves_its_tracks(api_client, library, tmp_path):
    real = tmp_path / "data" / "Music"
    real.mkdir(parents=True)
    link = tmp_path / "Music"
    link.symlink_to(real, target_is_directory=True)
    stored = real.resolve().as_posix()
    wanted = library(f"{stored}/Album/01.mp3", f"{stored}/Album/02.mp3")
    library(f"{tmp_path.resolve().as_posix()}/Elsewhere/03.mp3")

    # The root card's path, as `folderslib.create_folder` hands it out.
    assert _save_folder(api_client, link.as_posix() + "/") == sorted(wanted)


def test_a_folder_saves_only_itself_and_what_is_below_it(api_client, library, tmp_path):
    base = tmp_path.resolve().as_posix()
    wanted = library(f"{base}/Rock/a.mp3", f"{base}/Rock/Live/b.mp3")
    library(f"{base}/Rock and Roll/c.mp3")

    # In the native form: on Windows the backslash one, which no stored path has.
    assert _save_folder(api_client, str(tmp_path / "Rock")) == sorted(wanted)
