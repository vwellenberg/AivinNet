"""
Pure helpers for the folder-search index.

Kept dependency-free (only the standard library) so it can be unit tested in
isolation, without importing the SQLAlchemy-backed store modules.
"""

import pathlib
from collections.abc import Iterable


def derive_folder_paths(filepaths: Iterable[str], root_posix_paths: list[str]) -> list[tuple[str, str]]:
    """
    Derives every directory that (recursively) contains tracks, bounded to the
    given root directories. Pure function over filepaths — no filesystem access.

    Walks each filepath's ancestors upward, stopping at (and excluding) the root
    dir. A ``seen`` set makes this O(number of unique directories): once a
    directory has been visited, all of its ancestors have been too.

    :param filepaths: All indexed track filepaths.
    :param root_posix_paths: Root directories as posix strings. Results are
        limited to directories strictly below one of these; the roots
        themselves are excluded.
    :returns: List of ``(folder_name, folder_path)`` where ``folder_path`` is
        posix with a trailing slash (matching ``create_folder``).
    """
    seen: set[str] = set()
    folders: list[tuple[str, str]] = []

    for filepath in filepaths:
        parent = pathlib.Path(filepath).parent

        while True:
            posix = parent.as_posix()
            if posix in seen:
                break
            seen.add(posix)

            is_root = posix in root_posix_paths
            within = is_root or any(posix.startswith(root + "/") for root in root_posix_paths)
            if not within or is_root:
                break

            folders.append((parent.name, posix + "/"))
            parent = parent.parent

    return folders
