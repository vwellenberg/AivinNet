import json
import logging
import shutil
from dataclasses import asdict
from pathlib import Path
from time import time

import sqlalchemy.exc
from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.auth import admin_required
from aivinnet.db.userdata import CollectionTable, FavoritesTable, PlaylistTable, ScrobbleTable, UserTable
from aivinnet.lib.index import index_everything
from aivinnet.settings import Paths
from aivinnet.utils.auth import get_current_userid
from aivinnet.utils.dates import timestamp_to_time_passed

log = logging.getLogger(__name__)

bp_tag = Tag(name="Backup and Restore", description="Backup and Restore")
api = APIBlueprint("backup_and_restore", __name__, url_prefix="/backup", abp_tags=[bp_tag])


def get_backup_root() -> Path:
    """
    The one directory every backup lives in. A single definition so the guard
    below and its callers cannot disagree about what "inside" means.
    """
    return Path("~").expanduser() / "aivinnet.backup"


def copy_playlist_images(image: str, img_folder: Path) -> int:
    """
    Put one playlist's cover into the backup — the full picture AND its thumb.

    The thumbnail is a separate file (`thumb_<name>`, written by playlistlib
    when the cover is uploaded) and it is what every LIST view asks for. The
    backup used to carry the full image alone, so even once the restore learned
    to copy pictures back (#135), the sidebar and the playlist grid would have
    kept showing the placeholder while the playlist page looked fine.

    A function of its own because it is the only part of `create_backup` with a
    rule worth checking, and the endpoint around it needs a database, a request
    context and an admin to call at all.

    Returns the number of files copied, so a caller can tell "no cover" from
    "cover, no thumb".
    """
    copied = 0

    for name in (image, f"thumb_{image}"):
        source = Path(Paths().playlist_img_path) / name

        if not source.exists():
            continue

        img_folder.mkdir(parents=True, exist_ok=True)
        shutil.copy(source, img_folder / name)
        copied += 1

    return copied


def resolve_backup_dir(name: str) -> Path | None:
    """
    Resolve a client-supplied backup name inside the backup root, or return
    None if it points anywhere else.

    `root / name` is not a containment check — it is string surgery with two
    escapes. `"../.config/swingmusic"` walks out of the root, and an ABSOLUTE
    name makes pathlib discard the root entirely (`Path("/a") / "/etc"` is
    `/etc`). The endpoint downstream is `shutil.rmtree`, so either one deletes a
    directory of the caller's choosing (AivinNet-Client#437).

    Rejected: names that escape the root, the root itself, and empty names —
    each of those resolves to something the caller did not name.
    """
    if not name.strip():
        return None

    root = get_backup_root().resolve()
    candidate = (root / name).resolve()

    if candidate == root or not candidate.is_relative_to(root):
        return None

    return candidate


def all_scrobbles():
    """
    Every user's listening history.

    `ScrobbleTable.get_all` has no "all users" mode — it takes a userid and
    falls back to the current one — so this walks the user table instead of
    widening a signature five other callers share. All of them want one user's
    history; the instance backup is the only reader that wants everyone's.
    """
    for user in UserTable.get_all():
        yield from ScrobbleTable.get_all(start=0, userid=user.id)


def owner_resolver():
    """
    Decide which user a restored row belongs to.

    Ownership is KEPT where it can be. Restoring an instance backup on the
    instance it came from has to put everyone's rows back where they were;
    re-owning them to whoever pressed the button would quietly hand one user
    another's library. Only an owner this instance does not know falls back to
    the restoring user — that is the cross-instance case, and the alternative
    there is dropping the row on the floor (it would hit the `user.id` foreign
    key and be swallowed by the `except IntegrityError` below).

    ⚠️ The fallback COLLAPSES unknown owners onto one user. Restoring a foreign
    instance's backup where users 5 and 6 each had a "Road trip" lands both on
    the restoring user, where the second one is a duplicate of the first and
    gets skipped. That is accepted: the alternative is inventing users or
    renaming rows, and the honest outcome for a foreign backup is "you got one
    of each name". Restoring an instance's OWN backup — the case this endpoint
    exists for — never hits it, because every owner is known.

    The set of known users is read ONCE per section, not per row.
    """
    known_users = {user.id for user in UserTable.get_all()}
    current = get_current_userid()

    def resolve(row: dict) -> int:
        owner = row.get("userid")
        return owner if owner in known_users else current

    return resolve


@api.post("/create")
@admin_required()
def backup():
    """
    Create a backup file of your favorites, playlists, scrobble data, and collections.
    """
    backup_name = f"backup.{int(time())}"
    backup_dir = get_backup_root() / backup_name
    backup_dir.mkdir(parents=True, exist_ok=True)

    backup_file = backup_dir / "data.json"
    # Created on first use by `copy_playlist_images`, so an instance where no
    # playlist has a cover writes no empty directory. (The `img_folder_created`
    # flag that tracked this by hand went with it — `mkdir(exist_ok=True)` does
    # the same job without a second piece of state to keep in step.)
    img_folder = backup_dir / "images"

    # EVERY user's rows, in all four sections. This endpoint is
    # `@admin_required`, so it is an instance backup, not a personal one —
    # scoping it to the calling admin would leave every other user's data in no
    # backup at all, and they cannot make their own (same gate). Favorites were
    # widened first (AivinNet-Client#513) and the other three stayed personal,
    # which meant a restore brought user 2's favorites back but not the
    # playlists, history and collections they belong to (#527).
    #
    # The per-user correctness belongs on the restore side, where every
    # `restore_*` puts each row back under its own owner.
    favorites = FavoritesTable.get_all(with_user=False)
    favorites = [asdict(entry) for entry in favorites]

    scrobbles = [asdict(entry) for entry in all_scrobbles()]

    for scrobble in scrobbles:
        del scrobble["id"]

    # SECTION: Playlists
    playlists = PlaylistTable.get_all(current_user=False)
    playlist_dicts = []

    for entry in playlists:
        playlist = asdict(entry)
        for key in [
            "id",
            "_last_updated",
            "has_image",
            "images",
            "duration",
            "count",
            "pinned",
            "thumb",
        ]:
            del playlist[key]

        playlist_dicts.append(playlist)

        copy_playlist_images(str(playlist["image"]), img_folder)

    # !SECTION

    # SECTION: Collections
    collections_list = list(CollectionTable.get_all(current_user=False))
    collections_dicts = []

    for collection in collections_list:
        # Remove auto-generated id field
        collection_copy = collection.copy()
        if "id" in collection_copy:
            del collection_copy["id"]
        collections_dicts.append(collection_copy)
    # !SECTION
    data = {
        "favorites": favorites,
        "scrobbles": scrobbles,
        "playlists": playlist_dicts,
        "collections": collections_dicts,
    }

    with open(backup_file, "w") as f:
        json.dump(data, f, indent=4)

    return {
        "name": backup_name,
        "date": timestamp_to_time_passed(int(backup_name.split(".")[1])),
        "scrobbles": len(scrobbles),
        "favorites": len(favorites),
        "playlists": len(playlist_dicts),
        "collections": len(collections_dicts),
    }, 200


class SectionReport:
    """
    What a restore actually did to one section.

    `discarded` is the number that made these bugs survive so long: every
    `restore_*` swallowed its `IntegrityError` into a `print`, so a restore that
    dropped half the file still answered "Restored successfully" (#527). Counted
    and returned, it shows up where someone reads it.

    `skipped` is the healthy kind of not-restored — the row is already there.
    """

    def __init__(self):
        self.restored = 0
        self.skipped = 0
        self.discarded = 0

    def add(self, other: "SectionReport"):
        self.restored += other.restored
        self.skipped += other.skipped
        self.discarded += other.discarded

    def discard(self, section: str, row: dict, error: Exception):
        """
        Count a row the database refused, and say WHICH one and why.

        The count alone is un-actionable — "discarded: 412" tells nobody what to
        recover. The row and the exception go to the log at error level, the
        number goes to the caller; the old code had the row (on stdout, via
        `print`) and no number, which is how a restore could drop everything it
        read and still answer "Restored successfully".
        """
        self.discarded += 1
        log.error("Restore discarded a %s row: %s (%s)", section, row, error)

    def asdict(self) -> dict[str, int]:
        return {"restored": self.restored, "skipped": self.skipped, "discarded": self.discarded}


class RestoreBackup:
    # TODO: IMPROVE UX WHEN WAITING FOR RESTORE TO COMPLETE!

    def __init__(self, backup_dir: Path):
        self.backup_dir = backup_dir
        self.backup_file = backup_dir / "data.json"
        with open(self.backup_file) as f:
            self.data = json.load(f)

    def restore(self) -> dict[str, SectionReport]:
        """
        Restore all four sections and report what happened to each.

        ⚠️ The work used to run in `__init__` while this method was an empty
        `pass` — both callers already did `RestoreBackup(dir).restore()`, so
        moving it here changes nothing about when it runs and gives the counts
        somewhere to come out.
        """
        return {
            "favorites": self.restore_favorites(self.data["favorites"]),
            "playlists": self.restore_playlists(self.data["playlists"]),
            "playlist_images": self.restore_playlist_images(),
            "scrobbles": self.restore_scrobbles(self.data["scrobbles"]),
            "collections": self.restore_collections(self.data.get("collections", [])),
        }

    def restore_playlist_images(self) -> SectionReport:
        """
        Put the playlist covers back on disk.

        `create_backup` has always copied them next to `data.json`, and nothing
        ever copied them back: `self.backup_dir` was stored and never read
        (#135). So after a disk loss the playlists returned with their names,
        their tracks and the correct `image` value in the database — and every
        one of them showed the placeholder, while the JPEGs sat unused in the
        backup folder the whole time.

        ⚠️ Existing files are kept, never overwritten. A restore is additive
        everywhere else in this class, and the file on disk belongs to whatever
        the database currently says; replacing it would let an old backup
        silently change the cover of a playlist that was never lost.
        """
        report = SectionReport()
        source = self.backup_dir / "images"

        if not source.is_dir():
            return report

        target = Path(Paths().playlist_img_path)
        target.mkdir(parents=True, exist_ok=True)

        for image in sorted(source.iterdir()):
            if not image.is_file():
                continue

            destination = target / image.name

            if destination.exists():
                report.skipped += 1
                continue

            try:
                shutil.copy(image, destination)
                report.restored += 1
            except OSError as error:
                report.discard("playlist image", {"name": image.name}, error)
                continue

            if not image.name.startswith("thumb_"):
                self.rebuild_thumbnail(target, image.name)

        return report

    @staticmethod
    def rebuild_thumbnail(folder: Path, name: str):
        """
        Make the small version, for a backup that does not carry one.

        Backups written before this change hold the full cover only, and the
        thumbnail is the file every LIST view asks for — so without this, older
        backups would restore to exactly the symptom being fixed, just one
        rung down.

        A failure here is logged, not counted as a discard: the cover itself is
        already back, and the playlist page shows it. Only the small version is
        missing, and the image server falls back to the placeholder for that.
        """
        if (folder / f"thumb_{name}").exists():
            return

        try:
            from PIL import Image

            from aivinnet.lib.playlistlib import create_gif_thumbnail, create_thumbnail

            with Image.open(folder / name) as image:
                if getattr(image, "n_frames", 1) > 1:
                    create_gif_thumbnail(image, name)
                else:
                    create_thumbnail(image, name)
        except Exception as error:
            log.warning("Could not rebuild the thumbnail for playlist image %s: %s", name, error)

    def restore_favorites(self, favorites: list[dict]) -> SectionReport:
        """
        Put the backup's favorites back, each one under its owner.

        A favorite is identified by **(owner, type, hash)** — and every part of
        that was missing before (AivinNet-Client#513):

        - The duplicate check ignored the owner, so user 2 having favorited a
          track made user 1's copy of it unrestorable.
        - It compared the bare hash, which is only unique together with the
          type. A pinned album therefore swallowed the `album` favorite of the
          same album.
        - `insert_item` fills `userid` only when it is missing, so an id from
          the file that does not exist here hit the `user.id` foreign key and
          was dropped by the `except` below — which prints and moves on, so the
          restore reported success either way.
        """
        report = SectionReport()
        resolve_owner = owner_resolver()

        # Owner included: two users may legitimately favorite the same item.
        existing = {(fav.userid, fav.type, fav.hash) for fav in FavoritesTable.get_all(with_user=False)}

        for fav in favorites:
            owner = resolve_owner(fav)

            if (owner, fav["type"], fav["hash"]) in existing:
                report.skipped += 1
                continue

            try:
                FavoritesTable.insert_item({**fav, "userid": owner})
                existing.add((owner, fav["type"], fav["hash"]))
                report.restored += 1
            except sqlalchemy.exc.IntegrityError as error:
                report.discard("favorite", fav, error)

        return report

    def restore_playlists(self, playlists: list[dict]) -> SectionReport:
        """
        A playlist is identified by **(owner, name)**.

        Comparing the name alone read every playlist in the instance as "mine",
        so user 1 having a "Road trip" made user 2's unrestorable — and the
        backup only held user 1's in the first place (#527).
        """
        report = SectionReport()
        resolve_owner = owner_resolver()

        existing = {(playlist.userid, playlist.name) for playlist in PlaylistTable.get_all(current_user=False)}

        for playlist in playlists:
            owner = resolve_owner(playlist)

            if (owner, playlist["name"]) in existing:
                report.skipped += 1
                continue

            try:
                # `_score` is a search artefact on the dataclass, not a column.
                playlist = {key: value for key, value in playlist.items() if key != "_score"}
                PlaylistTable.add_one({**playlist, "userid": owner})
                existing.add((owner, playlist["name"]))
                report.restored += 1
            except sqlalchemy.exc.IntegrityError as error:
                report.discard("playlist", playlist, error)

        return report

    def restore_scrobbles(self, scrobbles: list[dict]) -> SectionReport:
        """
        A scrobble is identified by **(owner, trackhash, timestamp)**.

        Without the owner, one user having played a track at second X hid the
        other user's play of it — and, as above, the backup only carried the
        admin's history to begin with (#527).
        """
        report = SectionReport()
        resolve_owner = owner_resolver()

        existing = {(scrobble.userid, scrobble.trackhash, scrobble.timestamp) for scrobble in all_scrobbles()}

        for scrobble in scrobbles:
            owner = resolve_owner(scrobble)
            key = (owner, scrobble["trackhash"], scrobble["timestamp"])

            if key in existing:
                report.skipped += 1
                continue

            try:
                ScrobbleTable.add({**scrobble, "userid": owner})
                existing.add(key)
                report.restored += 1
            except sqlalchemy.exc.IntegrityError as error:
                report.discard("scrobble", scrobble, error)

        return report

    def restore_collections(self, collections: list[dict]) -> SectionReport:
        """
        A collection is identified by **(owner, name)** — same shape as
        playlists, same reason (#527).
        """
        report = SectionReport()
        resolve_owner = owner_resolver()

        existing = {
            (collection["userid"], collection["name"]) for collection in CollectionTable.get_all(current_user=False)
        }

        for collection in collections:
            owner = resolve_owner(collection)

            if (owner, collection["name"]) in existing:
                report.skipped += 1
                continue

            try:
                CollectionTable.insert_one({**collection, "userid": owner})
                existing.add((owner, collection["name"]))
                report.restored += 1
            except sqlalchemy.exc.IntegrityError as error:
                report.discard("collection", collection, error)

        return report


class RestoreBackupBody(BaseModel):
    backup_dir: str | None = Field(
        default=None,
        description="The name of the backup directory to restore from. If not provided, all backups will be restored.",
        example="backup.1234567890",
    )


@api.post("/restore")
@admin_required()
def restore(body: RestoreBackupBody):
    """
    Restore your favorites, playlists, scrobble data, and collections from a specified backup or all backups.
    """
    backup_base_dir = get_backup_root()
    backups = []
    # `playlist_images` counts FILES, not rows — it is here because a restore
    # that puts every playlist back and none of their covers should not be able
    # to look like a complete one in the response.
    totals = {
        section: SectionReport()
        for section in ("favorites", "playlists", "playlist_images", "scrobbles", "collections")
    }

    def run(directory: Path):
        for section, report in RestoreBackup(directory).restore().items():
            totals[section].add(report)

    if body.backup_dir:
        # Restore from a specific backup
        specified_backup_dir = resolve_backup_dir(body.backup_dir)
        if specified_backup_dir is None:
            return {"msg": f"Invalid backup name '{body.backup_dir}'"}, 400

        if not specified_backup_dir.exists() or not specified_backup_dir.is_dir():
            return {"msg": f"Backup '{body.backup_dir}' not found"}, 404

        run(specified_backup_dir)
        backups.append(body.backup_dir)
    else:
        # Restore from all backups
        try:
            backup_dirs = [d for d in backup_base_dir.iterdir() if d.is_dir()]
        except FileNotFoundError:
            backup_dirs = []

        if not backup_dirs:
            return {"msg": "No backups found"}, 404

        for backup_dir in sorted(backup_dirs, key=lambda x: x.name, reverse=True):
            run(backup_dir)
            backups.append(backup_dir.name)

    index_everything()

    # Per section: restored / skipped (already present) / discarded (rejected by
    # the database). The last one used to go to stdout only — a restore could
    # drop every row it read and still answer "Restored successfully" (#527).
    return {
        "msg": "Restored successfully",
        "backups": backups,
        "restored": {section: report.asdict() for section, report in totals.items()},
    }, 200


@api.get("/list")
@admin_required()
def list_backups():
    """
    List all backups with detailed information.
    """
    backup_dir = get_backup_root()
    backups = []

    entries = []
    try:
        paths = [p for p in backup_dir.iterdir() if p.is_dir()]
    except FileNotFoundError:
        paths = []

    for path in paths:
        try:
            entries.append({"path": path, "timestamp": int(path.name.split(".")[1])})
        except (IndexError, ValueError):
            pass

    entries = sorted(entries, key=lambda x: x["timestamp"], reverse=True)

    for entry in entries:
        backup_info = {
            "name": entry["path"].name,
            "date": timestamp_to_time_passed(entry["timestamp"]),
        }

        # Read the JSON file and count items
        json_file: Path = entry["path"] / "data.json"
        if json_file.exists():
            with json_file.open("r") as f:
                data = json.load(f)
                backup_info["scrobbles"] = len(data.get("scrobbles", []))
                backup_info["favorites"] = len(data.get("favorites", []))
                backup_info["playlists"] = len(data.get("playlists", []))
                backup_info["collections"] = len(data.get("collections", []))
        else:
            backup_info["scrobbles"] = 0
            backup_info["favorites"] = 0
            backup_info["playlists"] = 0
            backup_info["collections"] = 0

        backups.append(backup_info)

    return {"backups": backups}, 200


class DeleteBackupBody(BaseModel):
    backup_dir: str = Field(..., description="The name of the backup directory to delete.")


@api.delete("/delete")
@admin_required()
def delete_backup(body: DeleteBackupBody):
    """
    Delete a backup.
    """
    backup_dir = resolve_backup_dir(body.backup_dir)
    if backup_dir is None:
        return {"msg": f"Invalid backup name '{body.backup_dir}'"}, 400

    if not backup_dir.exists() or not backup_dir.is_dir():
        return {"msg": f"Backup '{body.backup_dir}' not found"}, 404

    shutil.rmtree(backup_dir)
    return {"msg": f"Backup '{body.backup_dir}' deleted"}, 200
