"""
"Almost complete" (#529): albums heard to at least 60 %, a few songs missing.
"""

from aivinnet.lib.home.almost_complete import (
    AlbumTracks,
    AlmostComplete,
    after_play,
    almost_complete_item,
    rank_almost_complete,
    rest_of,
)


def album(albumhash: str, n: int, artists: tuple[str, ...] = ("band",)) -> AlbumTracks:
    return AlbumTracks(albumhash, [f"{albumhash}/{i}" for i in range(1, n + 1)], artists)


def heard(albumhash: str, *numbers: int) -> set[str]:
    return {f"{albumhash}/{i}" for i in numbers}


def test_heard_most_but_not_all():
    ranked = rank_almost_complete([album("a", 10)], heard("a", 1, 2, 3, 4, 5, 6, 8))

    assert ranked == [AlmostComplete("a", ("a/7", "a/9", "a/10"), 10)]


def test_under_sixty_percent_or_complete_is_not_almost_complete():
    played = heard("a", 1, 2, 3, 4, 5) | heard("b", 1, 2, 3, 4, 5, 6) | heard("c", 1, 2, 3, 4)

    ranked = rank_almost_complete([album("a", 10), album("b", 10), album("c", 4)], played)

    # a: 50 %; b: exactly 60 % counts; c: heard through.
    assert [a.albumhash for a in ranked] == ["b"]


def test_a_single_or_an_ep_never_counts():
    assert rank_almost_complete([album("ep", 3)], heard("ep", 1, 2)) == []
    assert rank_almost_complete([album("lp", 4)], heard("lp", 1, 2, 3)) != []


def test_the_nearest_to_complete_first():
    played = heard("two", *range(1, 9)) | heard("one", *range(1, 5)) | heard("big", *range(1, 19))

    ranked = rank_almost_complete([album("two", 10), album("one", 5), album("big", 20)], played)

    # One missing, then two of 20 (90 %) before two of 10 (80 %).
    assert [a.albumhash for a in ranked] == ["one", "big", "two"]


def test_a_track_in_two_files_counts_once():
    doubled = AlbumTracks("d", ["d/1", "d/1", "d/2", "d/3", "d/4", "d/5"], ("band",))

    (ranked,) = rank_almost_complete([doubled], heard("d", 1, 2, 3, 4))

    assert ranked.total == 5 and ranked.missing == ("d/5",)


def test_untagged_albums_are_left_out():
    played = heard("u", 1, 2, 3, 4)
    unknown = album("u", 5, artists=("unknown",))

    assert rank_almost_complete([unknown], played, exclude={"unknown"}.__contains__) == []


def test_the_card_and_the_rest():
    first = AlmostComplete("a", ("a/7", "a/9"), 10)
    second = AlmostComplete("b", ("b/2",), 5)

    assert almost_complete_item(first) == {
        "type": "album",
        "hash": "a",
        "help_text": "2 songs to go",
        "home": {"missing": 2},
    }
    assert almost_complete_item(second)["help_text"] == "1 song to go"
    # "Play the rest": album after album, each in album order.
    assert rest_of([first, second]) == ["a/7", "a/9", "b/2"]


def test_an_album_without_album_artists_counts_as_untagged():
    bare = AlbumTracks("b", [f"b/{i}" for i in range(1, 6)], ())

    assert rank_almost_complete([bare], heard("b", 1, 2, 3, 4)) == []


def test_after_a_play_of_a_missing_song():
    items = [
        almost_complete_item(AlmostComplete("a", ("a/3", "a/5"), 5)),
        almost_complete_item(AlmostComplete("b", ("b/4",), 4)),
    ]
    rest = ["a/3", "a/5", "b/4"]

    cards, left = after_play(items, rest, "a/3", "a")
    assert [c["help_text"] for c in cards] == ["1 song to go", "1 song to go"] and left == ["a/5", "b/4"]

    # The last missing song takes the card along.
    cards, left = after_play(cards, left, "b/4", "b")
    assert [c["hash"] for c in cards] == ["a"] and left == ["a/5"]

    # A song that was not missing changes nothing.
    assert after_play(cards, left, "a/1", "a") == (cards, left)
