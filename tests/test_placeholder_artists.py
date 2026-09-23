"""
Placeholder artists ("Unknown", "Various Artists") never get a face.

Regression: Deezer has an artist literally named "Unknown", so the name-hash
match in the online image lookup accepted its picture (a compilation CD
cover) as the image of every untagged song, and the file stayed in the cache
after online metadata was switched off.
"""

from aivinnet.lib.placeholder_artists import is_placeholder_artist, purge_placeholder_artist_images
from aivinnet.utils.hashing import create_hash


def test_placeholder_names_in_their_tag_spellings():
    for name in ("Unknown", "unknown", "<unknown>", "[Unknown]", "Unknown Artist", "UNKNOWN ARTIST", "Various Artists"):
        assert is_placeholder_artist(name), name


def test_real_artists_are_not_placeholders():
    # Near misses included: a name that merely CONTAINS the word is a real credit.
    for name in ("Radiohead", "unknown ( irish traditional )", "The Unknowns", "Unknown Mortal Orchestra", "VA"):
        assert not is_placeholder_artist(name), name


def test_purge_removes_the_cached_face_in_every_size(tmp_path):
    folders = [tmp_path / size for size in ("small", "medium", "large")]
    unknown = create_hash("Unknown", decode=True)  # how Artist names the file
    real = create_hash("Radiohead", decode=True)

    for folder in folders:
        folder.mkdir()
        (folder / f"{unknown}.webp").write_bytes(b"compilation cover")
        (folder / f"{real}.webp").write_bytes(b"band photo")

    removed = purge_placeholder_artist_images(folders)

    assert sorted(removed) == sorted(folder / f"{unknown}.webp" for folder in folders)
    for folder in folders:
        assert not (folder / f"{unknown}.webp").exists()
        assert (folder / f"{real}.webp").read_bytes() == b"band photo"


def test_purge_without_cached_faces_is_a_no_op(tmp_path):
    assert purge_placeholder_artist_images([tmp_path]) == []
