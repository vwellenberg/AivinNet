from dataclasses import asdict, dataclass, field

from aivinnet.config import UserConfig
from aivinnet.utils.auth import get_current_userid
from aivinnet.utils.hashing import create_hash
from aivinnet.utils.parsers import (
    clean_title,
    get_base_title_and_versions,
    parse_feat_from_title,
    remove_prod,
    split_artists,
    strip_artist_credit,
    strip_track_number,
)


@dataclass(slots=True)
class Track:
    """
    Track class
    """

    id: int
    album: str
    albumartists: list[dict[str, str]]
    albumhash: str
    artists: list[dict[str, str]]
    bitrate: int
    copyright: str
    date: int
    disc: int
    duration: int
    filepath: str
    folder: str
    genres: str | list[dict[str, str]]
    last_mod: int
    title: str
    track: int
    trackhash: str
    extra: dict
    lastplayed: int
    playcount: int
    playduration: int

    config: UserConfig
    og_album: str = ""
    og_title: str = ""
    artisthashes: list[str] = field(default_factory=list)
    genrehashes: list[str] = field(default_factory=list)
    weakhash: str = ""

    _pos: int = 0
    _ati: str = ""
    image: str = ""
    _score: float = 0
    explicit: bool = False
    fav_userids: list[int] = field(default_factory=list)

    # What this track was called before the server cleaned its title and artist
    # names (`strip_track_number`, `strip_artist_credit`): the trackhash it had
    # then, and (old, new) artisthash pairs. Empty for every track the cleanup
    # leaves alone. Read once after loading, to carry favourites, playlists and
    # scrobbles over to the new hashes (`lib/name_cleanup.py`). Underscored, so
    # the serializers leave them out of every response.
    _legacyhash: str = ""
    _legacy_artisthashes: tuple[tuple[str, str], ...] = ()

    @property
    def is_favorite(self):
        return get_current_userid() in self.fav_userids

    @property
    def pathhash(self):
        return create_hash(self.folder)

    def toggle_favorite_user(self, userid: int):
        """
        Toggles the favorite status of the track for a given user.

        Args:
            userid (int): The ID of the user toggling the favorite status.
        """
        if userid in self.fav_userids:
            self.fav_userids.remove(userid)
        else:
            self.fav_userids.append(userid)

    def __post_init__(self):
        """
        Performs post-initialization processing on the track object.
        This includes setting original values, processing artists and genres,
        and removing duplicate artists.
        """
        self.og_title = self.title
        self.og_album = self.album
        self.folder = self.folder + "/"
        self.weakhash = create_hash(self.title, self.artists)

        explicit_tag = self.extra.get("explicit", ["0"])
        if isinstance(explicit_tag, list):
            explicit_tag = explicit_tag[0] if explicit_tag else "0"
        if isinstance(explicit_tag, str):
            explicit_tag = explicit_tag.lower()
            self.explicit = explicit_tag in ("1", "yes", "true")
        else:
            self.explicit = bool(explicit_tag)

        # Same file as Album.image — the entity travels as a query param so the
        # image server can fall back to the note placeholder instead of the
        # record one (imgserver.thumbnail_fallback).
        self.image = self.albumhash + ".webp" + "?pathhash=" + self.pathhash + "&fb=track"
        # self.extra = {
        #     "disc_total": self.extra.get("disc_total", 0),
        #     "track_total": self.extra.get("track_total", 0),
        #     "samplerate": self.extra.get("samplerate", -1),
        # }

        raw_names, raw_album_names = self.split_artists()
        self.map_with_config(raw_album_names)
        self.process_genres()

        # Remove duplicates from artists and albumartists
        seen_artists = set()
        self.artists = [
            d for d in self.artists if tuple(d.items()) not in seen_artists and not seen_artists.add(tuple(d.items()))
        ]

        seen_albumartists = set()
        self.albumartists = [
            d
            for d in self.albumartists
            if tuple(d.items()) not in seen_albumartists and not seen_albumartists.add(tuple(d.items()))
        ]

        self.recreate_trackhash()
        self.remember_legacy_identity(raw_names, raw_album_names)
        self.config = None

    def split_artists(self) -> tuple[list[str], list[str]]:
        """
        Splits the artists and albumartists based on the given separators,
        and updates the artisthashes.

        Returns the names as tagged, before `strip_artist_credit` took the role
        off them ("Composed by Adam Sporka" -> "Adam Sporka").
        """

        def named(names: list[str]):
            return [{"name": a, "artisthash": create_hash(a, decode=True)} for a in map(strip_artist_credit, names)]

        raw_names = split_artists(self.artists, config=self.config)
        raw_album_names = split_artists(self.albumartists, config=self.config)

        self.artists = named(raw_names)
        self.albumartists = named(raw_album_names)
        self.artisthashes = [a["artisthash"] for a in self.artists]

        return raw_names, raw_album_names

    def map_with_config(self, raw_album_names: list[str]):
        """
        Applies various transformations to the track's title and album
        based on the user's configuration settings.
        """
        # Not a setting: a track number in the title is never part of the name.
        raw_title = self.title
        new_title = self.title = strip_track_number(self.title, self.track, self.disc, self.filepath)

        # Extract featured artists
        if self.config.extractFeaturedArtists:
            feat, new_title = parse_feat_from_title(self.title, self.config)
            feat = [{"name": f, "artisthash": create_hash(f, decode=True)} for f in feat]
            feat = [f for f in feat if f["artisthash"] not in self.artisthashes]
            self.artists.extend(feat)
            self.artisthashes.extend([f["artisthash"] for f in feat])

            # Update album title for singles
            # ie. album: "Title (feat. Artist)"
            #     title: "Title (feat. Artist)"
            # becomes: album: "Title", title: "Title"
            #
            # From the title AS TAGGED: the number comes off the title, never
            # off an album's name — that would move the album to a new hash
            # under `mergeAlbums` and the legacy trackhash with it.
            if self.og_album == self.og_title:
                self.album = new_title if raw_title == self.title else parse_feat_from_title(raw_title, self.config)[1]

        # Clean track title
        if self.config.removeProdBy:
            new_title = remove_prod(new_title)

        # if self.title == new_title:
        #     self.album = new_title

        if self.config.removeRemasterInfo:
            new_title = clean_title(new_title)

        self.title = new_title

        # Clean album title
        if self.config.cleanAlbumTitle:
            self.album, _ = get_base_title_and_versions(self.album, get_versions=False)

        if self.config.mergeAlbums:
            # The names as TAGGED, not as cleaned: dropping "Composed by" must not
            # move an album to a new hash, which would orphan its cover and its
            # favourites.
            self.albumhash = create_hash(self.album, *raw_album_names)

    def process_genres(self):
        """
        Processes and standardizes the genre information for the track.
        """
        if self.genres:
            src_genres: str = self.genres

            src_genres = src_genres.lower()
            # separators = {"/", ";", "&"}
            separators = set(self.config.genreSeparators)

            contains_rnb = "r&b" in src_genres
            contains_rock = "rock & roll" in src_genres

            if contains_rnb:
                src_genres = src_genres.replace("r&b", "RnB")

            if contains_rock:
                src_genres = src_genres.replace("rock & roll", "rock")

            for s in separators:
                src_genres = src_genres.replace(s, ",")

            genres_list: list[str] = src_genres.split(",")
            self.genres = [{"name": g.strip(), "genrehash": create_hash(g.strip())} for g in genres_list]
            self.genrehashes = [g["genrehash"] for g in self.genres]

    def remember_legacy_identity(self, raw_names: list[str], raw_album_names: list[str]):
        """
        Record the hashes this track had before the name cleanup, if it changed any.

        The old trackhash is rebuilt the way the server built it until then: the
        title as tagged through the same setting-driven cleanup, the performers
        under their tagged names, featured ones added and duplicates dropped.
        """
        pairs = {
            (create_hash(name, decode=True), create_hash(clean, decode=True))
            for name in (*raw_names, *raw_album_names)
            if (clean := strip_artist_credit(name)) != name
        }
        self._legacy_artisthashes = tuple(sorted(pairs))

        title_changed = strip_track_number(self.og_title, self.track, self.disc, self.filepath) != self.og_title
        if not title_changed and not pairs:
            return

        old_title = self.og_title
        old_artists = [(name, create_hash(name, decode=True)) for name in raw_names]

        if self.config.extractFeaturedArtists:
            feat, old_title = parse_feat_from_title(old_title, self.config)
            known = {artisthash for _name, artisthash in old_artists}
            old_artists += [(f, h) for f in feat if (h := create_hash(f, decode=True)) not in known]
        if self.config.removeProdBy:
            old_title = remove_prod(old_title)
        if self.config.removeRemasterInfo:
            old_title = clean_title(old_title)

        old_names = [name for name, _hash in dict.fromkeys(old_artists)]
        legacy = create_hash(old_title, self.album, *old_names)

        if legacy != self.trackhash:
            self._legacyhash = legacy

    def recreate_trackhash(self):
        """
        Recreates the trackhash based on the current title, album, and artist information.
        """
        self.trackhash = create_hash(self.title, self.album, *(artist["name"] for artist in self.artists))

    def copy(self):
        return Track(**{**asdict(self), "config": UserConfig()})
