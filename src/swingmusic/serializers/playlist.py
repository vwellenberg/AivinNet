from dataclasses import asdict

from swingmusic.models.playlist import Playlist


def serialize_for_card(playlist: Playlist, to_remove=None):
    if to_remove is None:
        to_remove = set()
    p_dict = asdict(playlist)

    props = {"trackhashes"}.union(to_remove)

    for key in props:
        p_dict.pop(key, None)

    # Cards never consume the per-track added_at map (it scales with the
    # playlist size); drop it even when the caller didn't clear_lists() first.
    extra = p_dict.get("extra")
    if extra and "added_at" in extra:
        p_dict["extra"] = {k: v for k, v in extra.items() if k != "added_at"}

    return p_dict
