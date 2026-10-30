from dataclasses import asdict, dataclass, field

from aivinnet.config import UserConfig
from aivinnet.utils.auth import get_current_userid
from aivinnet.utils.hashing import create_hash
from aivinnet.utils.parsers import (
    clean_title,
    get_base_title_and_versions,
    parse_feat_from_title,
    remove_prod,
    repair_mojibake,
    split_artists,
    strip_artist_credit,
    strip_artist_credit_until_2026_10,
    strip_artist_credits,
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
    # When the file came into the library (`track.added`), for "Recently added"
    # and every "Date added". Not `last_mod`: a tag edit moves that one.
    added: int = 0

    # What this track was called before the server cleaned its title and artist
    # names (`strip_track_number`, `strip_artist_credit`): the trackhash it had
    # then, and (old, new) artisthash pairs. Empty for every track the cleanup
    # leaves alone. Read once after loading, to carry favourites, playlists and
    # scrobbles over to the new hashes (`lib/name_cleanup.py`). Underscored, so
    # the serializers leave them out of every response.
    _legacyhash: str = ""
    _legacy_artisthashes: tuple[tuple[str, str], ...] = ()
    # The trackhashes under the cleanups of the releases before, where they
    # differ from both: credits as stripped until 2026-10, then the cleanup
    # before `repair_mojibake`. A library that already ran one of them holds its
    # references there, not under the raw tags.
    _previoushashes: tuple[str, ...] = ()

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
        # The names as they stand in the file. Every hash the library knew this
        # track by was made of these, mangled or not.
        tagged_title, tagged_album = self.title, self.album
        tagged_artists, tagged_albumartists = self.artists, self.albumartists
        self.title, self.album = repair_mojibake(self.title), repair_mojibake(self.album)
        self.artists, self.albumartists = repair_mojibake(self.artists), repair_mojibake(self.albumartists)

        self.og_title = self.title
        self.og_album = self.album
        self.folder = self.folder + "/"
        # A row from before the column, until the backfill has run: the mtime
        # is all that is known, and it is what "added" meant until then.
        if not self.added:
            self.added = self.last_mod
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

        names_repaired = (tagged_artists, tagged_albumartists) != (self.artists, self.albumartists)
        tagged_names, tagged_album_names = self.split_artists()
        if names_repaired:
            tagged_names = split_artists(tagged_artists, config=self.config)
            tagged_album_names = split_artists(tagged_albumartists, config=self.config)
        self.map_with_config(self.shown_album(tagged_album, tagged_title), tagged_album_names)
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
        self.remember_legacy_identity(tagged_title, tagged_album, tagged_names, tagged_album_names)
        self.config = None

    def split_artists(self) -> tuple[list[str], list[str]]:
        """
        Splits the artists and albumartists based on the given separators,
        and updates the artisthashes.

        Returns the names as split, before `strip_artist_credits` took the roles
        off them ("Composed by Adam Sporka" -> "Adam Sporka").
        """

        def named(names: list[str]):
            return [{"name": a, "artisthash": create_hash(a, decode=True)} for a in strip_artist_credits(names)]

        raw_names = split_artists(self.artists, config=self.config)
        raw_album_names = split_artists(self.albumartists, config=self.config)

        self.artists = named(raw_names)
        self.albumartists = named(raw_album_names)
        self.artisthashes = [a["artisthash"] for a in self.artists]

        return raw_names, raw_album_names

    def shown_album(self, album: str, title: str) -> str:
        """
        The album's name as the library shows it, from `album` and `title`.

        From the title as TAGGED: the number comes off the title, never off an
        album's name — that would move the album to a new hash under
        `mergeAlbums` and the legacy trackhash with it.
        """
        # Update album title for singles
        # ie. album: "Title (feat. Artist)"
        #     title: "Title (feat. Artist)"
        # becomes: album: "Title", title: "Title"
        if self.config.extractFeaturedArtists and album == title:
            album = parse_feat_from_title(title, self.config)[1]

        if self.config.cleanAlbumTitle:
            album, _ = get_base_title_and_versions(album, get_versions=False)

        return album

    def map_with_config(self, tagged_album: str, tagged_album_names: list[str]):
        """
        Applies various transformations to the track's title and album
        based on the user's configuration settings.

        `tagged_album` and `tagged_album_names` are the album as `shown_album`
        makes it and the album artists, both from the names in the file before
        `repair_mojibake`: the hash `mergeAlbums` gives an album stays the one
        its cover and its favourites are filed under.
        """
        # Not a setting: a track number in the title is never part of the name.
        new_title = self.title = strip_track_number(self.title, self.track, self.disc, self.filepath)

        # Extract featured artists
        if self.config.extractFeaturedArtists:
            feat, new_title = parse_feat_from_title(self.title, self.config)
            feat = [{"name": f, "artisthash": create_hash(f, decode=True)} for f in feat]
            feat = [f for f in feat if f["artisthash"] not in self.artisthashes]
            self.artists.extend(feat)
            self.artisthashes.extend([f["artisthash"] for f in feat])

        # Clean track title
        if self.config.removeProdBy:
            new_title = remove_prod(new_title)

        # if self.title == new_title:
        #     self.album = new_title

        if self.config.removeRemasterInfo:
            new_title = clean_title(new_title)

        self.title = new_title
        self.album = self.shown_album(self.og_album, self.og_title)

        if self.config.mergeAlbums:
            # The names as TAGGED, not as cleaned: dropping "Composed by" must not
            # move an album to a new hash, which would orphan its cover and its
            # favourites.
            self.albumhash = create_hash(tagged_album, *tagged_album_names)

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

    def remember_legacy_identity(self, title: str, album: str, names: list[str], album_names: list[str]):
        """
        Record the hashes this track had before the name cleanup, if it changed any.

        `title`, `album`, `names` and `album_names` are as they stand in the
        file, before `repair_mojibake` and before any credit came off.

        Old trackhashes, each rebuilt the way the server built it then, with
        the same setting-driven title cleanup, featured artists added and
        duplicates dropped: `_legacyhash` from the tags as they are, and
        `_previoushashes` under the cleanups of the releases before (only where
        they differ from both). A stricter rule later freezes the current one
        next to them (track-tags.md).
        """
        repaired = (title, album) != (self.og_title, self.og_album)
        # Featured artists come out of the title, and so did their mangled names.
        featured = []
        if repaired and self.config.extractFeaturedArtists:
            featured = parse_feat_from_title(title, self.config)[0]

        pairs = set()
        for name in (*names, *album_names, *featured):
            clean = strip_artist_credit(repair_mojibake(name))
            if clean == name:
                continue
            new = create_hash(clean, decode=True)
            # Raw, and as the release before the repair cleaned it.
            for old in {name, strip_artist_credit(name)} - {clean}:
                if (old_hash := create_hash(old, decode=True)) != new:
                    pairs.add((old_hash, new))
        self._legacy_artisthashes = tuple(sorted(pairs))

        stripped_title = strip_track_number(title, self.track, self.disc, self.filepath)
        if stripped_title == title and not pairs and not repaired:
            return

        old_album = self.shown_album(album, title)

        def hash_as(title: str, names: list[str]) -> str:
            old_artists = [(name, create_hash(name, decode=True)) for name in names]

            if self.config.extractFeaturedArtists:
                feat, title = parse_feat_from_title(title, self.config)
                known = {artisthash for _name, artisthash in old_artists}
                old_artists += [(f, h) for f in feat if (h := create_hash(f, decode=True)) not in known]
            if self.config.removeProdBy:
                title = remove_prod(title)
            if self.config.removeRemasterInfo:
                title = clean_title(title)

            old_names = [name for name, _hash in dict.fromkeys(old_artists)]
            return create_hash(title, old_album, *old_names)

        # Before any cleanup: the tags as they are.
        legacy = hash_as(title, names)
        if legacy != self.trackhash:
            self._legacyhash = legacy

        # Under the cleanups of the releases before: a library that ran one
        # holds its references there. Until 2026-10 a credit like "Lyrics by"
        # stayed ("Composed by A; Lyrics by B" was "A", "Lyrics by B"); until the
        # repair, mangled names stayed mangled ("Whereâ€™s Freya").
        # One place per release, "" where it adds nothing: the mapping compares
        # old hashes of the same release with each other.
        previous: list[str] = []
        for old in (
            hash_as(stripped_title, [strip_artist_credit_until_2026_10(name) for name in names]),
            hash_as(stripped_title, strip_artist_credits(names)),
        ):
            previous.append("" if old in (legacy, self.trackhash, *previous) else old)
        while previous and not previous[-1]:
            previous.pop()
        self._previoushashes = tuple(previous)

    def recreate_trackhash(self):
        """
        Recreates the trackhash based on the current title, album, and artist information.
        """
        self.trackhash = create_hash(self.title, self.album, *(artist["name"] for artist in self.artists))

    def copy(self):
        return Track(**{**asdict(self), "config": UserConfig()})
