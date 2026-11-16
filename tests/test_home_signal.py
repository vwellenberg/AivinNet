"""The logo's find (#828): which stored item of the two rows the plate shows."""

from aivinnet.lib.home.signal import pick_find


def album(h: str) -> dict:
    # As the routine stores it (`never_played_item`), not yet recovered.
    return {"type": "album", "hash": h, "help_text": "never played"}


def track(h: str) -> dict:
    return {"type": "track", "hash": h, "help_text": "last May 2025", "secondary_text": "12 plays"}


def test_nothing_to_find():
    assert pick_find([]) is None
    assert pick_find([("Never played", []), ("Forgotten favorite", [])]) is None


def test_the_find_carries_its_reason_and_item():
    assert pick_find([("Never played", [album("a1")])]) == ("Never played", album("a1"))


def test_every_item_weighs_the_same_across_rows():
    seen = []
    pools = [("Never played", [album("a1"), album("a2"), album("a3")]), ("Forgotten favorite", [track("t1")])]

    pick_find(pools, choice=lambda c: seen.extend(c) or c[0])

    # One flat list: a one-item row is not as likely as a whole other row.
    assert [item["hash"] for _, item in seen] == ["a1", "a2", "a3", "t1"]
    assert [reason for reason, _ in seen] == ["Never played"] * 3 + ["Forgotten favorite"]


def test_another_never_repeats_the_find_on_the_plate():
    pools = [("Never played", [album("a1"), album("a2")])]

    assert {pick_find(pools, skip="a1")[1]["hash"] for _ in range(30)} == {"a2"}


def test_the_only_find_comes_again_rather_than_nothing():
    # "Another" with a single candidate: the same item beats an empty plate.
    assert pick_find([("Forgotten favorite", [track("t1")])], skip="t1")[1]["hash"] == "t1"


def test_only_albums_and_tracks_with_a_hash_take_part():
    pools = [("Never played", [{"type": "artist", "hash": "x"}, {"type": "album"}, {"type": "album", "hash": ""}])]

    assert pick_find(pools) is None
