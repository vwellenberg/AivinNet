import pathlib
from concurrent.futures import ThreadPoolExecutor

from sortedcontainers import SortedSet

from aivinnet.lib.folder_index import derive_folder_paths
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.filesystem import safe_dir_prefix


class FolderStore:
    """
    The Folder store is used to hold all the indexed tracks filepaths in memory
    for fast count operations when browsing the folder page.

    Counting from the database is super slow,
    even with a small number of folders to get the count for Up to 700 ms for 10 folders.
    By using this store, we are able to reduce that to less than 10 ms.
    """

    filepaths: SortedSet = SortedSet()
    map: dict[str, str] = {}
    """
    The map above is a dictionary that maps the folder path to the track hash, which can be used to fetch the track from the track store (a dict of track hashes to track objects).
    """
    added: dict[str, int] = {}
    """
    filepath -> when the file came into the library (`Track.added`), for the
    "Folder date" (`newest_added`). Its own dict and not a walk through `map`
    into the track store: that took 321 ms for a root over 200k files on the
    single request thread, this 55 ms.
    """

    @classmethod
    def load_filepaths(cls):
        """
        Load all the filepaths of the track store into memory.

        This is needed to speed up the process of counting the number of tracks in the folder page.
        """
        # Built aside and swapped in whole, like the track store (#296): a
        # cleared set made every folder count 0 during a rescan, and the map
        # was never cleared at all, so removed files stayed in it.
        # ⚠️ A SortedSet, like the class attribute: the folder counts bisect it
        # (`get_index_of_first_match` indexes `paths[mid]`). A plain set here —
        # the store swap in 2026.10.2 — made every Home with a folder row, and
        # every folder count, answer 500.
        #
        # From the track store, not a second pass over the table (#391): the
        # map points INTO that store, by hash. Read from the database after
        # Albums and Artists had loaded, it lagged the store by the whole
        # rebuild, and every file whose hash a scan had changed went missing
        # from its folder in between (`get_tracks_by_filepaths` skips a hash
        # the store does not know). Call this right after the track store swap.
        filepaths: SortedSet = SortedSet()
        filemap: dict[str, str] = {}
        added: dict[str, int] = {}

        for track in TrackStore.get_flat_list():
            filepaths.add(track.filepath)
            filemap[track.filepath] = track.trackhash
            added[track.filepath] = track.added

        cls.filepaths = filepaths
        cls.map = filemap
        cls.added = added
        cls._generation += 1

    @classmethod
    def index_file(cls, filepath: str, trackhash: str, added: int | None = None) -> None:
        """
        Record one file under its CURRENT trackhash.

        ⚠️ The folder view finds a file's track through this map, by hash. A tag
        edit changes the hash, and until this existed nothing told the map: the
        folder of an album whose titles had just been repaired listed 0 of its
        94 files, and stayed that way until the next full rescan.
        """
        filepath = pathlib.Path(filepath).as_posix()
        if filepath not in cls.filepaths:
            cls.filepaths.add(filepath)
            cls._generation += 1  # a new path; a tag edit keeps the folder index
        cls.map[filepath] = trackhash
        if added is not None:
            cls.added[filepath] = added

    @classmethod
    def move_filepath(cls, old: str, new: str, trackhash: str) -> None:
        """Follow a renamed file (the trackhash does not change with the path)."""
        old = pathlib.Path(old).as_posix()
        cls.filepaths.discard(old)
        cls.map.pop(old, None)
        added = cls.added.pop(old, None)
        cls._generation += 1
        cls.index_file(new, trackhash, added)

    @classmethod
    def get_tracks_by_filepaths(cls, filepaths: list[str]):
        """
        Generator which tries to match TrackStore with track hash
        """
        for filepath in filepaths:
            filepath = pathlib.Path(filepath).as_posix()

            if filepath in cls.map:
                trackhash = cls.map[filepath]
                trackgroup = TrackStore.trackhashmap.get(trackhash)

                if trackgroup is None:
                    continue

                for track in trackgroup.tracks:
                    if track.filepath == filepath:
                        yield track

    @classmethod
    def count_tracks_containing_paths(cls, paths: list[str]):
        """
        Count the number of tracks in each directory.

        Uses a ThreadPoolExecutor to count the number of tracks
        in each directory for fast execution time.
        """

        # Counted under the prefix the scanner stores beneath a folder:
        # resolved (a root behind a symlink counted 0) and with its trailing
        # `/` (`/music/Rock` counted `/music/Rock and Roll/` too) (#391).
        prefixes = [safe_dir_prefix(path) for path in paths]
        with ThreadPoolExecutor() as executor:
            res = executor.map(count_filepaths_in_dir, ((prefix, FolderStore.filepaths) for prefix in prefixes))
            results = [{"path": path, "trackcount": count} for path, count in zip(paths, res, strict=False)]

        return results

    @classmethod
    def newest_added(cls, paths: list[str]) -> dict[str, int]:
        """
        path -> when music last came into it: the newest `added` of the tracks
        beneath it (0 for none). The "Folder date" of the folder view.

        Not the directory's mtime. That moves with every entry created or
        deleted in it, and the app makes those itself: the `.bak` of each tag
        edit, a `.lrc` from the lyrics finder, a rename. A folder of long-known
        music jumped to the top for each (lib/date_added.py). From the stores,
        so a folder gone since it was listed is no OSError either.
        """
        filepaths, added = cls.filepaths, cls.added
        result: dict[str, int] = {}

        for path in paths:
            prefix = safe_dir_prefix(path)
            index = get_index_of_first_match(filepaths, prefix)
            newest = 0

            if index != -1:
                for filepath in filepaths.islice(index):
                    if not filepath.startswith(prefix):
                        break
                    newest = max(newest, added.get(filepath, 0))

            result[path] = newest

        return result

    # ── Folder search index ───────────────────────────────────────────────
    # A cached list of (name, path) for every directory that (recursively)
    # contains tracks, within the configured root dirs. Derived from the
    # in-memory `filepaths` index so folder search never walks the filesystem.
    _folder_index: list[tuple[str, str]] = []
    _folder_index_key: tuple = ()
    # Bumped by every change to `filepaths`. The index used to be keyed on
    # their NUMBER: a renamed folder of N files (N out, N in) kept its old
    # name in the folder search until the count changed (#391).
    _generation: int = 0

    @classmethod
    def get_folder_index(cls) -> list[tuple[str, str]]:
        """
        Returns the cached folder index as a list of (name, path) tuples,
        rebuilt when the indexed filepaths or the root dirs have changed.
        """
        roots = cls._resolve_root_dirs()
        key = (cls._generation, tuple(roots))
        if cls._folder_index and cls._folder_index_key == key:
            return cls._folder_index

        cls._folder_index = derive_folder_paths(cls.filepaths, roots)
        cls._folder_index_key = key
        return cls._folder_index

    @staticmethod
    def _resolve_root_dirs() -> list[str]:
        """
        Returns the configured root directories as posix path strings,
        resolving the special "$home" entry to the user's home directory.
        """
        # Imported lazily to avoid a circular import at module load time.
        from aivinnet import settings
        from aivinnet.config import UserConfig

        roots: list[str] = []
        for root_dir in UserConfig().rootDirs:
            if root_dir == "$home":
                # Use the exact source the indexer scans (tagger.py), i.e. the
                # *resolved* home dir, so the prefixes match track filepaths.
                roots.append(settings.Paths().USER_HOME_DIR.as_posix())
            else:
                roots.append(pathlib.Path(root_dir).as_posix())

        return roots


def get_index_of_first_match(paths: list[str], prefix: str) -> int:
    """
    Find index of first match.
    Uses binary search to speed up the search process.

    :params paths: List of string to march.
    :params prefix: Prefix to match against with `startswith`.
    :returns: -1 if no element found, 0 if everything matches, else result > 0
    """

    left = 0
    right = len(paths) - 1

    while left <= right:
        mid = (left + right) // 2

        if paths[mid].startswith(prefix):
            if mid == 0 or not paths[mid - 1].startswith(prefix):
                return mid
            right = mid - 1

        elif paths[mid] < prefix:
            left = mid + 1

        else:
            right = mid - 1

    return -1


def count_filepaths_in_dir(_map: tuple[str, SortedSet]):
    """
    Counts the number of filepaths that start with the given directory path.

    Gets the index of the first path that starts with the given directory path,
    then check each path after that to see if it starts with the given directory path.
    """
    dirpath, filepaths = _map
    index = get_index_of_first_match(filepaths, dirpath)
    if index == -1:
        return 0

    count = 0

    # `islice`, not `filepaths[index:]`: a slice builds the whole tail as a
    # list, so a root of 1000 folders over 200k paths took 578 ms instead of
    # 11 on the single request thread (#391).
    for path in filepaths.islice(index):
        if path.startswith(dirpath):
            count += 1
        else:
            break

    return count
