import os
from pathlib import Path

FILES = ["flac", "mp3", "wav", "m4a", "ogg", "wma", "opus", "alac", "aiff"]
SUPPORTED_FILES = tuple(f".{file}" for file in FILES)


def is_hidden_path(path: str) -> bool:
    """
    Whether a directory/file entry should be skipped when scanning.

    Excludes hidden dot-entries and ``$``-prefixed system entries. This
    notably filters out macOS **AppleDouble** sidecar files (``._track.mp3``),
    which share the real file's audio extension and would otherwise be indexed
    as ghost tracks/albums/artists. Applies the same rule to files that the
    scanner already applied to directories, so both are treated consistently.

    Accepts either a bare entry name or a full path (POSIX or Windows
    separators); only the final path component is inspected.
    """
    name = path.replace("\\", "/").rsplit("/", 1)[-1]
    return name.startswith(".") or name.startswith("$")


# TODO: Move this to config
# INFO: Skip these paths when scanning
IGNORE_PATH_ENDSWITH = {
    "node_modules",
    "site-packages",
    "postgres",
    "__pycache__",
    "/src",
    "/learnrs",
    "/venv",
    "/code",
    "/dist",
    "/demos",
    "/temp",
}


IGNORE_PATH_CONTAINS = {
    "Photos Library",
}


def run_fast_scandir(path: str, full=False) -> tuple[list[str], list[str]]:
    """
    Scans a directory for files with a specific extension.
    Returns a list of files and folders in the directory.

    TODO: possible recursion error on link inside link: ``dir/folder1/subfolder1/<link-to-folder1>/subfolder1/...``

    :param path: folder to scan
    :param full: will call recursively until end of path.
    :return: (folder:[], files:[])
    """

    # filter out unwanted known folders
    if isinstance(path, str):
        if path == "":
            return [], []

    path: Path = Path(path).resolve()

    if any(path.as_posix().endswith(ignore_path) for ignore_path in IGNORE_PATH_ENDSWITH):
        return [], []

    if any(ignore_path in path.as_posix() for ignore_path in IGNORE_PATH_CONTAINS):
        return [], []

    # if on mac, ignore Library folder and its children
    if os.name == "posix":
        library_path = (Path.home() / "Library").resolve()
        if path == library_path or str(path).startswith(str(library_path)):
            return [], []

    subfolders = []
    files = []

    try:
        for entry in path.iterdir():
            if is_hidden_path(entry.name):
                continue  # filter out system / hidden files (incl. AppleDouble ._* sidecars)

            if entry.is_dir():
                subfolders.append(entry)

            if entry.is_file():
                ext = entry.suffix.lower()
                if ext in SUPPORTED_FILES:
                    files.append(entry.as_posix())

        if full or len(files) == 0:
            for folder in subfolders:
                sub_dirs, subfiles = run_fast_scandir(folder, full=True)
                subfolders.extend(sub_dirs)
                files.extend(subfiles)

    except (OSError, PermissionError, FileNotFoundError, ValueError):
        return [], []

    return subfolders, files
