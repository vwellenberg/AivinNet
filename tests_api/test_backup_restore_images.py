"""
Backup -> restore of the playlist COVERS, not just the playlist rows.

`create_backup` has copied every cover next to `data.json` since long before
this fork. Nothing ever copied them back: `RestoreBackup` stored `backup_dir`
and read only `data.json` from it (#135). So after a disk loss the playlists
came back with their names, their tracks and the right `image` value in the
database, every one of them showing the placeholder — while the pictures sat
unused in the backup folder the whole time.

Three properties, and the first two are the ones that were broken:

    the covers land in the playlist image directory
    a cover already on disk is KEPT, not overwritten by the backup's copy
    a backup with no thumbnail gets one built, because the lists ask for it

The thumbnail matters on its own: it is a separate file (`thumb_<name>`) and it
is what every LIST view requests. Restoring only the full cover would have fixed
the playlist page and left the sidebar and the playlist grid on the placeholder
— the same bug one rung down.
"""

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

from aivinnet.api.backup_and_restore import RestoreBackup, copy_playlist_images


@pytest.fixture()
def backup_dir(tmp_path: Path) -> Path:
    """A backup holding one cover, one thumbnail, and the empty sections."""
    directory = tmp_path / "backup.1700000000"
    (directory / "images").mkdir(parents=True)

    (directory / "data.json").write_text(
        json.dumps({"favorites": [], "playlists": [], "scrobbles": [], "collections": []}),
        encoding="utf-8",
    )

    Image.new("RGB", (400, 400), "teal").save(directory / "images" / "7abcde.webp")
    Image.new("RGB", (250, 250), "teal").save(directory / "images" / "thumb_7abcde.webp")

    return directory


@pytest.fixture()
def image_dir(tmp_path: Path):
    """
    Point `Paths().playlist_img_path` at a temp directory.

    Patched on the CLASS, and asserted through the module the code actually
    imports: `Paths` is a Singleton whose attributes are resolved per instance,
    and an earlier round in this project passed a staleness test for the wrong
    reason by patching the class where the instance was read.
    """
    target = tmp_path / "playlist-images"
    target.mkdir()

    with patch("aivinnet.api.backup_and_restore.Paths") as paths:
        paths.return_value.playlist_img_path = target
        yield target


def test_covers_are_restored(backup_dir: Path, image_dir: Path):
    report = RestoreBackup(backup_dir).restore_playlist_images()

    assert (image_dir / "7abcde.webp").exists(), "the cover stayed in the backup folder"
    assert (image_dir / "thumb_7abcde.webp").exists(), "the thumbnail stayed in the backup folder"
    assert report.restored == 2
    assert report.skipped == 0
    assert report.discarded == 0


def test_an_existing_cover_is_kept(backup_dir: Path, image_dir: Path):
    """
    A restore is additive everywhere else in this class, and the file on disk
    belongs to whatever the database currently says. Overwriting would let an
    old backup silently change the cover of a playlist that was never lost.
    """
    Image.new("RGB", (400, 400), "orange").save(image_dir / "7abcde.webp")

    report = RestoreBackup(backup_dir).restore_playlist_images()

    with Image.open(image_dir / "7abcde.webp") as kept:
        assert kept.getpixel((0, 0))[0] > 200, "the backup's teal cover overwrote the orange one on disk"

    assert report.skipped == 1
    assert report.restored == 1, "the thumbnail was missing and should still have been restored"


def test_a_missing_thumbnail_is_rebuilt(backup_dir: Path, image_dir: Path):
    """
    Backups written before this change hold the full cover only — and the
    thumbnail is the file the lists ask for.
    """
    (backup_dir / "images" / "thumb_7abcde.webp").unlink()

    with patch("aivinnet.settings.Paths") as settings_paths:
        # playlistlib writes through its own `settings.Paths()` lookup.
        settings_paths.return_value.playlist_img_path = image_dir
        RestoreBackup(backup_dir).restore_playlist_images()

    rebuilt = image_dir / "thumb_7abcde.webp"
    assert rebuilt.exists(), "no thumbnail was built for a backup that carries none"

    with Image.open(rebuilt) as thumb:
        assert thumb.height == 250, f"thumbnail is {thumb.height}px high, playlistlib builds 250px"


def test_a_backup_without_images_is_not_an_error(tmp_path: Path, image_dir: Path):
    """Older backups, and instances where no playlist ever had a cover."""
    directory = tmp_path / "backup.1700000001"
    directory.mkdir()
    (directory / "data.json").write_text(
        json.dumps({"favorites": [], "playlists": [], "scrobbles": [], "collections": []}),
        encoding="utf-8",
    )

    report = RestoreBackup(directory).restore_playlist_images()

    assert (report.restored, report.skipped, report.discarded) == (0, 0, 0)


def test_backup_takes_the_thumbnail_too(tmp_path: Path, image_dir: Path):
    """
    The other half of the round trip.

    Restoring covers is worth nothing if the backup never held them, and the
    thumbnail was the half that was missing: `create_backup` copied
    `playlist["image"]` and stopped there.
    """
    Image.new("RGB", (400, 400), "teal").save(image_dir / "9zyxwv.webp")
    Image.new("RGB", (250, 250), "teal").save(image_dir / "thumb_9zyxwv.webp")

    img_folder = tmp_path / "backup.1700000002" / "images"
    copied = copy_playlist_images("9zyxwv.webp", img_folder)

    assert copied == 2
    assert (img_folder / "9zyxwv.webp").exists()
    assert (img_folder / "thumb_9zyxwv.webp").exists(), "the thumbnail was left out of the backup"


def test_backup_writes_no_folder_for_a_playlist_without_a_cover(tmp_path: Path, image_dir: Path):
    img_folder = tmp_path / "backup.1700000003" / "images"

    assert copy_playlist_images("does-not-exist.webp", img_folder) == 0
    assert not img_folder.exists(), "an empty images/ directory was created anyway"
