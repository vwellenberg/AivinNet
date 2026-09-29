"""`install.sh --music` must write the file the app actually reads.

It wrote `config.json`, while `Paths.config_file_path` is `settings.json` — so
the pre-selected music folder was never seen, and a fresh install came up with
an empty library. Found by installing v2026.9.0 in a clean container and
upgrading it to the release candidate.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _app_settings_file_name() -> str:
    source = (ROOT / "src" / "aivinnet" / "settings.py").read_text(encoding="utf-8")
    match = re.search(r"def config_file_path\(self\)[^:]*:\s*return self\.config_dir / \"([^\"]+)\"", source)
    assert match, "Paths.config_file_path moved — update this test"
    return match.group(1)


def test_the_music_preselection_goes_into_the_apps_settings_file():
    installer = (ROOT / "install.sh").read_text(encoding="utf-8")
    written = re.findall(r'>\s*"\$\{DATA_DIR\}/([\w.]+)"', installer)

    assert written, "install.sh no longer writes a file into DATA_DIR — update this test"
    assert written == [_app_settings_file_name()]


def test_an_existing_settings_file_is_left_alone():
    """An update must not replace the library folders the user picked."""
    installer = (ROOT / "install.sh").read_text(encoding="utf-8")

    assert f'-f "${{DATA_DIR}}/{_app_settings_file_name()}"' in installer
