"""Three small bugs from the pre-release audit (#296)."""

from types import SimpleNamespace


def test_a_rename_takes_both_lyrics_files_along(tmp_path):
    """Only `.lrc` moved; the extended `.rlrc` stayed under the old name."""
    from aivinnet.lib.track_rename import _move_lyrics

    old, new = tmp_path / "02 - Song.mp3", tmp_path / "03 - Song.mp3"
    (tmp_path / "02 - Song.lrc").write_text("plain")
    (tmp_path / "02 - Song.rlrc").write_text("extended")

    assert _move_lyrics(str(old), str(new)) is None
    assert (tmp_path / "03 - Song.lrc").read_text() == "plain"
    assert (tmp_path / "03 - Song.rlrc").read_text() == "extended"
    assert not (tmp_path / "02 - Song.rlrc").exists()


def test_a_taken_lyrics_name_is_reported_not_overwritten(tmp_path):
    from aivinnet.lib.track_rename import _move_lyrics

    (tmp_path / "a.rlrc").write_text("mine")
    (tmp_path / "b.rlrc").write_text("theirs")

    warning = _move_lyrics(str(tmp_path / "a.mp3"), str(tmp_path / "b.mp3"))

    assert "b.rlrc" in warning
    assert (tmp_path / "b.rlrc").read_text() == "theirs"


def test_recently_played_is_empty_not_a_500_without_history(monkeypatch):
    import aivinnet.lib.home.recentlyplayed as rp

    monkeypatch.setattr(rp.ScrobbleTable, "get_all", classmethod(lambda cls, *a: []))

    playlist, tracks = rp.get_recently_played_playlist()

    assert tracks == []
    assert playlist.name == "Recently Played"


def test_an_artist_listing_a_popped_album_still_answers(monkeypatch):
    """A tag edit can pop an album while an artist entry still lists it."""
    from aivinnet.store.albums import AlbumStore
    from aivinnet.store.artists import ArtistStore

    live = SimpleNamespace(album=SimpleNamespace(albumhash="live"))
    monkeypatch.setattr(ArtistStore, "artistmap", {"va": SimpleNamespace(albumhashes={"live", "gone"})})
    monkeypatch.setattr(AlbumStore, "albummap", {"live": live})

    assert AlbumStore.get_albums_by_artisthash("va") == [live.album]
