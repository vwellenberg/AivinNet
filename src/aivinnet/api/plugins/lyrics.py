from flask_openapi3 import APIBlueprint, Tag
from pydantic import Field

from aivinnet.api.apischemas import TrackHashSchema
from aivinnet.db.userdata import PluginTable
from aivinnet.lib.lyrics import Lyrics as Lyrics_class
from aivinnet.lib.trackslib import resolve_track_filepath
from aivinnet.plugins.lyrics import Lyrics, pick_best
from aivinnet.settings import Defaults

bp_tag = Tag(name="Lyrics Plugin", description="LRCLIB lyrics plugin")
api = APIBlueprint("lyricsplugin", __name__, url_prefix="/plugins/lyrics", abp_tags=[bp_tag])


class LyricsSearchBody(TrackHashSchema):
    title: str = Field(description="The track title ", example=Defaults.API_TRACKNAME)
    artist: str = Field(description="The track artist ", example=Defaults.API_ARTISTNAME)
    album: str = Field(description="The track track album ", example=Defaults.API_ALBUMNAME)
    filepath: str = Field(
        description="Track filepath to save the lyrics file relative to",
        example="/home/cwilvx/temp/crazy song.mp3",
    )


def is_lyrics_finder_active() -> bool:
    return any(p.name == "lyrics_finder" and p.active for p in PluginTable.get_all())


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

    # ⚠️ The switch is enforced HERE, not only in the client. This request is
    # what sends title and artist to LRCLIB, and the client decides to make
    # it from its own copy of the plugin settings — which a stale tab, an old
    # client or a sub-option left on (`auto_download`) can get wrong. Off means
    # nothing leaves the machine, whoever asks.
    if not is_lyrics_finder_active():
        return {"error": "The lyrics finder is switched off"}, 403

    finder = Lyrics()
    data = finder.search_lyrics_by_title_and_artist(title, artist)

    best = pick_best(data, title, album)

    if best is None:
        return {"trackhash": trackhash, "lyrics": None}

    # ⚠️ The lyrics are written to disk as `<filepath>.lrc`, so `filepath` decides
    # WHERE the server creates a file. Taking it from the request meant any
    # logged-in account — the guest included — could create a file anywhere the
    # service user can write. Honour it only when it is one of the files the
    # named track actually resolves to; otherwise fall back to the track's own
    # path. Legitimate clients send exactly that path and are unaffected.
    filepath = resolve_track_filepath(trackhash, filepath)

    if filepath is None:
        return {"error": "Unknown track"}, 404

    lrc = finder.download_lyrics(best["track_id"], filepath)

    if lrc is None:
        return {"trackhash": trackhash, "lyrics": None}, 200

    # Plain lyrics are a result too: many songs have no timed version yet.
    # `format_synced_lyrics` raises on them, so answer in the shape GET /lyrics
    # uses for a local unsynced file, and say which one it is.
    lyrics = Lyrics_class(lrc)
    if lyrics.is_synced:
        return {"trackhash": trackhash, "lyrics": lyrics.format_synced_lyrics(), "synced": True}, 200

    return {"trackhash": trackhash, "lyrics": lyrics.format_unsynced_lyrics(), "synced": False}, 200
