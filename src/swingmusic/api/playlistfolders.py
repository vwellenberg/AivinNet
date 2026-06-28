"""
Playlist folder routes — group playlists into folders in the library sidebar.

Flat folders (no nesting). A folder holds an ordered list of playlist ids
(manual drag order); a playlist belongs to at most one folder. Deleting a
folder never deletes its playlists — they simply return to the top level.
"""

from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from swingmusic.db.userdata import PlaylistFolderTable

bp_tag = Tag(name="Playlist Folders", description="Group playlists into sidebar folders")
api = APIBlueprint("playlistfolders", __name__, url_prefix="/playlistfolders", abp_tags=[bp_tag])


@api.get("")
def get_folders():
    """
    List the current user's playlist folders (ordered).
    """
    return list(PlaylistFolderTable.get_all())


class CreateFolderBody(BaseModel):
    name: str = Field(description="The folder name", example="Chill")


@api.post("")
def create_folder(body: CreateFolderBody):
    """
    Create a new, empty playlist folder.
    """
    name = body.name.strip()
    if not name:
        return {"error": "Folder name is required"}, 400

    position = len(list(PlaylistFolderTable.get_all()))
    folder_id = PlaylistFolderTable.create(name, position)

    return PlaylistFolderTable.get_by_id(folder_id), 201


class FolderIdPath(BaseModel):
    folder_id: int = Field(description="The folder id")


class RenameFolderBody(BaseModel):
    name: str = Field(description="The new folder name")


@api.put("/<int:folder_id>")
def rename_folder(path: FolderIdPath, body: RenameFolderBody):
    """
    Rename a folder.
    """
    if PlaylistFolderTable.get_by_id(path.folder_id) is None:
        return {"error": "Folder not found"}, 404

    name = body.name.strip()
    if not name:
        return {"error": "Folder name is required"}, 400

    PlaylistFolderTable.update_one(path.folder_id, {"name": name})
    return PlaylistFolderTable.get_by_id(path.folder_id)


@api.delete("/<int:folder_id>")
def delete_folder(path: FolderIdPath):
    """
    Delete a folder. Its playlists are kept and fall back to the top level.
    """
    if PlaylistFolderTable.get_by_id(path.folder_id) is None:
        return {"error": "Folder not found"}, 404

    PlaylistFolderTable.delete_by_id(path.folder_id)
    return {"message": "Folder deleted"}


class MovePlaylistBody(BaseModel):
    playlist_id: int = Field(description="The playlist to move")
    folder_id: int | None = Field(default=None, description="Target folder id, or null for the top level")
    position: int = Field(default=-1, description="Insert position in the target folder (-1 = append)")


@api.post("/move")
def move_playlist(body: MovePlaylistBody):
    """
    Move a playlist into a folder (or out to the top level) at a position. Also
    used to reorder a playlist within its folder. The playlist is first removed
    from every folder so it lives in at most one.
    """
    pid = body.playlist_id

    for folder in list(PlaylistFolderTable.get_all()):
        if pid in folder["items"]:
            PlaylistFolderTable.update_one(folder["id"], {"items": [i for i in folder["items"] if i != pid]})

    if body.folder_id is None:
        return {"message": "Playlist moved to top level"}

    target = PlaylistFolderTable.get_by_id(body.folder_id)
    if target is None:
        return {"error": "Folder not found"}, 404

    items = [i for i in target["items"] if i != pid]
    pos = body.position if 0 <= body.position <= len(items) else len(items)
    items.insert(pos, pid)
    PlaylistFolderTable.update_one(body.folder_id, {"items": items})

    return PlaylistFolderTable.get_by_id(body.folder_id)


class FolderPosition(BaseModel):
    id: int = Field(description="Folder id")
    position: int = Field(description="New position in the shared sidebar order")


class ReorderFoldersBody(BaseModel):
    positions: list[FolderPosition] = Field(description="Explicit folder positions")


@api.post("/reorder")
def reorder_folders(body: ReorderFoldersBody):
    """
    Set folder positions. Positions live in the same space as playlist
    settings.position so folders and pinned playlists can be freely interleaved
    in the library sidebar.
    """
    for item in body.positions:
        PlaylistFolderTable.update_one(item.id, {"position": item.position})

    return {"message": "Folders reordered"}
