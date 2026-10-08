from aivinnet.db.userdata import FavoritesTable, PlaylistTable
from aivinnet.lib.home.generated_playlists import GENERATED_PLAYLISTS
from aivinnet.lib.playlistlib import get_first_4_images
from aivinnet.serializers.album import album_serializer
from aivinnet.serializers.artist import serialize_for_card
from aivinnet.serializers.playlist import serialize_for_card as serialize_playlist
from aivinnet.serializers.track import serialize_track
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.store.folder import FolderStore
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.dates import timestamp_to_time_passed


def recover_items(items: list[dict]):
    recovered = []

    for item in items:
        recovered_item = None

        if item["type"] == "album":
            album = AlbumStore.get_album_by_hash(item["hash"])
            if album is None:
                continue

            album = album_serializer(
                album,
                to_remove={
                    "genres",
                    "date",
                    "count",
                    "duration",
                    "albumartists_hashes",
                    "og_title",
                },
            )

            recovered_item = {
                "type": "album",
                "item": album,
            }
        elif item["type"] == "artist":
            artist = ArtistStore.get_artist_by_hash(item["hash"])
            if artist is None:
                continue

            recovered_item = {
                "type": "artist",
                "item": serialize_for_card(artist),
            }
        elif item["type"] == "folder":
            count = FolderStore.count_tracks_containing_paths([item["hash"]])

            recovered_item = {
                "type": "folder",
                "item": {
                    "path": item["hash"],
                    "count": count[0]["trackcount"],
                },
            }
        elif item["type"] == "playlist":
            if item.get("is_custom"):
                handler = GENERATED_PLAYLISTS.get(item["hash"])
                if handler is None:
                    continue
                playlist, _ = handler()
                playlist.images = [i["image"] for i in playlist.images]

                playlist = serialize_playlist(playlist, to_remove={"settings", "duration"})
                recovered_item = {
                    "type": "playlist",
                    "item": playlist,
                }
            else:
                playlist = PlaylistTable.get_by_id(item["hash"])
                if playlist is None:
                    continue

                tracks = TrackStore.get_tracks_by_trackhashes(playlist.trackhashes)
                playlist.clear_lists()

                if not playlist.has_image:
                    images = get_first_4_images(tracks)
                    images = [i["image"] for i in images]
                    playlist.images = images

                recovered_item = {
                    "type": "playlist",
                    "item": serialize_playlist(playlist),
                }
        elif item["type"] == "favorite":
            image = None
            last_trackhash = FavoritesTable.get_last_trackhash()

            if last_trackhash:
                trackhash = last_trackhash.replace("track_", "")
                entry = TrackStore.trackhashmap.get(trackhash)
                if entry:
                    image = entry.tracks[0].image

            recovered_item = {
                "type": "favorite",
                "item": {
                    "count": FavoritesTable.count_tracks(),
                    "image": image,
                },
            }
        elif item["type"] == "track":
            track = TrackStore.trackhashmap.get(item["hash"])
            if track is None:
                continue

            recovered_item = {
                "type": "track",
                "item": serialize_track(track.get_best()),
            }

        if recovered_item is not None:
            helptext = item.get("help_text") or item.get("type")
            secondary_text = item.get("secondary_text")

            if "secondary_text" in item:
                secondary_text = item["secondary_text"]
            elif "timestamp" in item:
                secondary_text = timestamp_to_time_passed(item["timestamp"])

            if helptext:
                recovered_item["item"]["help_text"] = helptext

            if secondary_text:
                recovered_item["item"]["time"] = secondary_text

            # "Continue listening": where in the album/playlist the user is.
            for key in ("track_index", "track_total"):
                if key in item:
                    recovered_item["item"][key] = item[key]
            # What a row draws on its cards beyond the shared fields ("On
            # repeat": the weekly bars and the factor).
            if "home" in item:
                recovered_item["item"]["home"] = item["home"]
            # Under its own name: the recovered item is the album/playlist
            # card, and a bare `trackhash` on it would read as its identity.
            if "trackhash" in item and "track_index" in item:
                recovered_item["item"]["resume_trackhash"] = item["trackhash"]

            recovered.append(recovered_item)

    return recovered
