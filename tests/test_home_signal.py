"""The logo's find (#828): which card of the two rows the plate shows."""

from aivinnet.lib.home.signal import card_hash, pick_find


def album(h: str) -> dict:
    return {"type": "album", "item": {"albumhash": h, "title": f"Album {h}"}}


def track(h: str) -> dict:
    return {"type": "track", "item": {"trackhash": h, "title": f"Song {h}"}}


def test_nothing_to_find():
    assert pick_find([]) is None
    assert pick_find([("Never played", []), ("Forgotten favorite", [])]) is None


def test_the_find_carries_its_reason_and_card():
    find = pick_find([("Never played", [album("a1")])])

    assert find == {"type": "album", "reason": "Never played", "item": album("a1")["item"]}


def test_every_card_weighs_the_same_across_rows():
    seen = []
    pools = [("Never played", [album("a1"), album("a2"), album("a3")]), ("Forgotten favorite", [track("t1")])]

    pick_find(pools, choice=lambda c: seen.extend(c) or c[0])

    # One flat list: a one-card row is not as likely as a whole other row.
    assert [card_hash(card) for _, card in seen] == ["a1", "a2", "a3", "t1"]
    assert [reason for reason, _ in seen] == ["Never played"] * 3 + ["Forgotten favorite"]


def test_another_never_repeats_the_find_on_the_plate():
    pools = [("Never played", [album("a1"), album("a2")])]

    assert {pick_find(pools, skip="a1")["item"]["albumhash"] for _ in range(30)} == {"a2"}


def test_the_only_find_comes_again_rather_than_nothing():
    # "Another" with a single candidate: the same card beats an empty plate.
    assert pick_find([("Forgotten favorite", [track("t1")])], skip="t1")["item"]["trackhash"] == "t1"


def test_cards_without_an_identity_are_left_out():
    pools = [("Never played", [{"type": "artist", "item": {"artisthash": "x"}}, {"type": "album", "item": {}}])]

    assert pick_find(pools) is None
