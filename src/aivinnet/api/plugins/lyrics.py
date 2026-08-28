from flask_openapi3 import APIBlueprint, Tag
from pydantic import Field

from aivinnet.api.apischemas import TrackHashSchema
from aivinnet.lib.lyrics import Lyrics as Lyrics_class
from aivinnet.lib.trackslib import resolve_track_filepath
from aivinnet.plugins.lyrics import Lyrics
from aivinnet.settings import Defaults
from aivinnet.utils.hashing import create_hash

bp_tag = Tag(name="Lyrics Plugin", description="Musixmatch lyrics plugin")
api = APIBlueprint("lyricsplugin", __name__, url_prefix="/plugins/lyrics", abp_tags=[bp_tag])


class LyricsSearchBody(TrackHashSchema):
    title: str = Field(description="The track title ", example=Defaults.API_TRACKNAME)
    artist: str = Field(description="The track artist ", example=Defaults.API_ARTISTNAME)
    album: str = Field(description="The track track album ", example=Defaults.API_ALBUMNAME)
    filepath: str = Field(
        description="Track filepath to save the lyrics file relative to",
        example="/home/cwilvx/temp/crazy song.mp3",
    )


@api.post("/search")
def search_lyrics(body: LyricsSearchBody):
    """
    Search for lyrics by title and artist
    """
    title = body.title
    artist = body.artist
    album = body.album
    filepath = body.filepath
    trackhash = body.trackhash

    finder = Lyrics()
    data = finder.search_lyrics_by_title_and_artist(title, artist)

    if not data:
        return {"trackhash": trackhash, "lyrics": None}

    perfect_match = data[0]

    for track in data:
        i_title = track["title"]
        i_album = track["album"]

        if create_hash(i_title) == create_hash(title) and create_hash(i_album) == create_hash(album):
            perfect_match = track

    # ⚠️ The lyrics are written to disk as `<filepath>.lrc`, so `filepath` decides
    # WHERE the server creates a file. Taking it from the request meant any
    # logged-in account — the guest included — could create a file anywhere the
    # service user can write. Honour it only when it is one of the files the
    # named track actually resolves to; otherwise fall back to the track's own
    # path. Legitimate clients send exactly that path and are unaffected.
    filepath = resolve_track_filepath(trackhash, filepath)

    if filepath is None:
        return {"error": "Unknown track"}, 404

    track_id = perfect_match["track_id"]
    lrc = finder.download_lyrics(track_id, filepath)

    if lrc is not None:
        lyrics = Lyrics_class(lrc)
        return {"trackhash": trackhash, "lyrics": lyrics.format_synced_lyrics()}, 200

    return {"trackhash": trackhash, "lyrics": lrc}, 200
