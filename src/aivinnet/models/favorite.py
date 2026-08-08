from dataclasses import dataclass
from typing import Any, Literal


@dataclass
class Favorite:
    hash: str
    type: Literal["album", "track", "artist"]
    timestamp: int
    userid: int
    extra: dict[str, Any]

    def __post_init__(self):
        # Remove the type prefix from the hash.
        #
        # ⚠️ This is the other half of `FavoritesTable.insert_item`, which adds
        # it. Everything that reads a favorite therefore sees the RAW hash —
        # including `create_backup`, which is why the restore may hand its rows
        # straight back to the prefixing `insert_item` without doubling
        # anything. Reading only the insert side makes the restore look broken
        # (AivinNet-Client#451); the round trip is pinned in
        # tests_api/test_backup_restore_favorites.py.
        self.hash = self.hash.replace(f"{self.type}_", "")
