"""Two request-thread costs from the pre-release audit (#295)."""

from types import SimpleNamespace


class CountingMap(dict):
    lookups = 0

    def get(self, key, default=None):
        CountingMap.lookups += 1
        return super().get(key, default)


def test_the_collage_stops_resolving_once_it_has_four_covers(monkeypatch):
    """GET /playlists builds it for every cover-less playlist; a 30k-track
    playlist was resolved in full for four pictures."""
    import aivinnet.lib.playlistlib as playlistlib

    hashes = [f"t{i:05d}" for i in range(10_000)]
    groups = CountingMap({h: SimpleNamespace(get_best=lambda h=h: SimpleNamespace(albumhash=f"al{h}")) for h in hashes})
    CountingMap.lookups = 0
    monkeypatch.setattr(playlistlib.TrackStore, "trackhashmap", groups)
    monkeypatch.setattr(
        playlistlib.AlbumStore,
        "get_albums_by_hashes",
        classmethod(lambda cls, hs: [SimpleNamespace(image=f"{h}.webp", color="") for h in hs]),
    )
    monkeypatch.setattr(playlistlib, "get_cover_content_key", lambda image: image)

    images = playlistlib.get_first_4_images(trackhashes=hashes)

    assert [i["image"] for i in images] == [f"alt{i:05d}.webp" for i in range(4)]
    assert CountingMap.lookups == 4


def test_the_playlist_list_honours_no_images(monkeypatch):
    import aivinnet.api.playlist as api

    calls = []
    playlist = SimpleNamespace(name="Big", has_image=False, trackhashes=["a"], images=[], clear_lists=lambda: None)
    monkeypatch.setattr(api.PlaylistTable, "get_all", classmethod(lambda cls: [playlist]))
    monkeypatch.setattr(api.playlistlib, "get_first_4_images", lambda **kw: calls.append(kw) or [])

    api.send_all_playlists(api.SendAllPlaylistsQuery(no_images=True))
    assert calls == []

    api.send_all_playlists(api.SendAllPlaylistsQuery(no_images=False))
    assert len(calls) == 1


def test_album_stats_copy_each_album_once(monkeypatch):
    """One deep copy per scrobble made a heavy listener's Stats page stall the
    whole server."""
    import aivinnet.utils.stats as stats

    scrobbles = [SimpleNamespace(trackhash=f"t{i % 3}", duration=100) for i in range(300)]
    monkeypatch.setattr(stats.ScrobbleTable, "get_all_in_period", classmethod(lambda cls, *a: scrobbles))
    monkeypatch.setattr(
        stats.TrackStore,
        "get_tracks_by_trackhashes",
        classmethod(lambda cls, hs: [SimpleNamespace(albumhash="al1" if hs[0] != "t2" else "al2")]),
    )
    albums = {
        h: SimpleNamespace(album=SimpleNamespace(albumhash=h, playcount=999, playduration=999)) for h in ("al1", "al2")
    }
    monkeypatch.setattr(stats.AlbumStore, "albummap", albums)
    copies = []
    real_deepcopy = stats.copy.deepcopy
    monkeypatch.setattr(stats.copy, "deepcopy", lambda obj: copies.append(obj) or real_deepcopy(obj))

    result = {a.albumhash: a.playcount for a in stats.get_albums_in_period(0, 1)}

    assert result == {"al1": 200, "al2": 100}
    assert len(copies) == 2
    assert albums["al1"].album.playcount == 999  # the store's own object is untouched
