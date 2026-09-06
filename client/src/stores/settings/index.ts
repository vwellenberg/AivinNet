import { defineStore } from 'pinia'

import { DBSettings, contextChildrenShowMode } from '@/enums'
import { pluginSetActive, updatePluginSettings } from '@/requests/plugins'

import { updateConfig } from '@/requests/settings'
import useDeviceSync from '@/stores/devicesync'
import { usePlayer } from '@/stores/player'
import { content_width, isMobile } from '../content-width'
import { getLastFmApiSig } from '@/context_menus/hashing'
import useAxios from '@/requests/useAxios'
import { paths } from '@/config'
import { router, Routes } from '@/router'
import { themeForNow } from '@/utils/autoTheme'

export default defineStore('settings', {
    state: () => ({
        version: '',
        contextChildrenShowMode: contextChildrenShowMode.hover,
        artist_top_tracks_count: 5,
        // repeat_all: true,
        // repeat_one: false,
        repeat: <'all' | 'one' | 'none'>'all',
        /**
         * Permanent shuffle ("random track") mode, like Spotify's shuffle toggle:
         * while on, the next track is picked at random from the queue and the
         * visible queue order is left untouched. This is NOT the queue panel's
         * one-shot "shuffle queue" action, which still reorders the list itself.
         *
         * The flag lives here so it persists, but it is flipped through
         * `useQueue().toggleShuffle()` — that store owns the re-roll and already
         * imports this one, so the toggle does not add a second import cycle.
         */
        shuffle: false,
        root_dir_set: false,
        root_dirs: <string[]>[],

        enablePeriodicScans: false,
        periodicInterval: 0,
        enableWatchDog: false,

        volume: 1.0,
        mute: false,
        // The volume to come back to when the speaker button turns sound back
        // on. Without it, un-muting a player whose volume happens to be 0 is
        // silent — and on a phone there is no slider to fix that with.
        last_audible_volume: 1.0,

        feat: true,
        prodby: true,
        clean_titles: true,
        hide_remaster: true,
        merge_albums: false,
        show_albums_as_singles: false,
        separators: <string[]>[],
        show_playlists_in_folders: false,

        // client
        streaming_quality: 'original',
        streaming_container: 'mp3',
        font: <'default' | 'spotify'>'default',

        // plugins
        use_lyrics_plugin: <boolean | undefined>false,
        lyrics_plugin_settings: {
            auto_download: false,
            overide_unsynced: false,
        },
        lasftfm_token: '',
        lastfm_api_key: '',
        lastfm_api_secret: '',
        lastfm_session_key: '',
        lastfm_integration_started: false,

        // audio
        use_silence_skip: true,
        use_crossfade: false,
        crossfade_duration: 1000, // milliseconds
        use_legacy_streaming_endpoint: false,

        // layout
        // Memphis theme: 'light' = grid paper, 'dark' = classic-90s indigo.
        theme: <'light' | 'dark'>'light',
        /**
         * Pick the theme from the time of day in Berlin: light 08:00–19:59,
         * dark otherwise. Evaluated on app start and re-checked while the app
         * stays open (see App.vue). Toggling the theme by hand switches this off.
         */
        auto_theme: false,
        /**
         * Cover-tinted veil over the grid ground on the detail pages (album,
         * artist, playlist). Off leaves the bare grid paper. Read centrally in
         * utils/colortools/pageGradient.ts.
         */
        use_page_gradient: true,
        // Now Playing Lauflicht intensity. Defaults to the subtler level.
        np_lauflicht_level: <'off' | 'subtle' | 'normal'>'subtle',
        use_sidebar: false,
        sidebar_width: 240,
        // Library sidebar: playing a playlist bubbles it to the top of its
        // group (pinned/un-pinned). On by default.
        move_played_playlist_to_top: true,

        // stats
        statsgroup: 'artists',
        statsperiod: 'week',
        _highlightFavoriteTracks: false,
    }),
    actions: {
        mapDbSettings(settings: DBSettings) {
            this.version = settings.version
            this.root_dirs = settings.rootDirs
            this.feat = settings.extractFeaturedArtists
            this.prodby = settings.removeProdBy
            this.clean_titles = settings.cleanAlbumTitle
            this.hide_remaster = settings.removeRemasterInfo
            this.merge_albums = settings.mergeAlbums
            this.separators = settings.artistSeparators
            this.show_albums_as_singles = settings.showAlbumsAsSingles
            this.show_playlists_in_folders = settings.showPlaylistsInFolderView

            this.enablePeriodicScans = settings.enablePeriodicScans
            this.periodicInterval = settings.scanInterval
            this.enableWatchDog = settings.enableWatchDog

            this.lastfm_api_key = settings.lastfmApiKey
            this.lastfm_api_secret = settings.lastfmApiSecret
            this.lastfm_session_key = settings.lastfmSessionKey
            this.use_lyrics_plugin = settings.plugins.find(p => p.name === 'lyrics_finder')?.active

            if (this.use_lyrics_plugin) {
                this.lyrics_plugin_settings = settings.plugins.find(p => p.name === 'lyrics_finder')?.settings
            }
        },
        setArtistSeparators(separators: string[]) {
            this.separators = separators
        },
        // theme 👇
        setTheme(theme: 'light' | 'dark') {
            this.theme = theme
        },
        toggleTheme() {
            this.theme = this.theme === 'light' ? 'dark' : 'light'
            // Picking a theme by hand is taking control: automatic switching
            // would otherwise snap the choice back at the next check and read as
            // the toggle being broken.
            this.auto_theme = false
        },
        toggleAutoTheme() {
            this.auto_theme = !this.auto_theme

            if (this.auto_theme) this.applyAutoTheme()
        },
        /** Set the theme from the current Berlin time (no-op unless auto is on). */
        applyAutoTheme() {
            if (!this.auto_theme) return

            this.theme = themeForNow()
        },
        togglePageGradient() {
            this.use_page_gradient = !this.use_page_gradient
        },
        // now playing 👇
        setNpLauflichtLevel(level: 'off' | 'subtle' | 'normal') {
            this.np_lauflicht_level = level
        },
        cycleNpLauflichtLevel() {
            const order = ['off', 'subtle', 'normal'] as const
            const next = (order.indexOf(this.np_lauflicht_level) + 1) % order.length
            this.np_lauflicht_level = order[next]
        },
        toggleHighlightFavoriteTracks() {
            this._highlightFavoriteTracks = !this._highlightFavoriteTracks
        },
        // sidebar 👇
        // No layout guard any more. It read "the alternate layout has no room
        // for the queue panel", which made CTRL+B a one-way switch as soon as
        // that layout became the only one — press it once and the panel was
        // gone for good. The wide chrome now has its own three-column grid for
        // the panel (app-grid.scss), so the toggle is simply a toggle.
        toggleDisableSidebar() {
            this.use_sidebar = !this.use_sidebar
        },
        toggleMovePlayedPlaylistToTop() {
            this.move_played_playlist_to_top = !this.move_played_playlist_to_top
        },
        // context menu 👇
        setContextChildrenShowMode(mode: contextChildrenShowMode) {
            this.contextChildrenShowMode = mode
        },
        toggleContextChildrenShowMode() {
            this.contextChildrenShowMode =
                this.contextChildrenShowMode === contextChildrenShowMode.click
                    ? contextChildrenShowMode.hover
                    : contextChildrenShowMode.click
        },
        // repeat 👇
        toggleRepeatMode() {
            // Repeat is shared across the group: broadcast a set_repeat command
            // and let the mirrored state flip it locally (volume/mute stay local).
            const ds = useDeviceSync()
            if (ds.joined && !ds.applying) {
                const next = this.repeat == 'all' ? 'one' : this.repeat == 'one' ? 'none' : 'all'
                ds.intercept('toggleRepeat', next)
                return
            }

            if (this.repeat == 'all') {
                this.repeat = 'one'
                return
            }

            if (this.repeat == 'one') {
                this.repeat = 'none'
                return
            }

            if (this.repeat == 'none') {
                this.repeat = 'all'
            }
        },
        setRootDirs(dirs: string[]) {
            this.root_dirs = dirs
        },
        setFont(value: 'default' | 'spotify') {
            this.font = value
        },
        toggleFont() {
            this.font = this.font === 'spotify' ? 'default' : 'spotify'
        },
        toggleCleanTrackTitles() {
            this.clean_titles = !this.clean_titles
        },
        toggleShowAlbumAsSingle() {
            this.show_albums_as_singles = !this.show_albums_as_singles
        },
        // volume 👇
        setVolume(new_value: number) {
            const { setVolume } = usePlayer()

            setVolume(new_value)
            this.volume = new_value

            // Remember the last level that actually made a sound, so the
            // speaker button has somewhere to return to.
            if (new_value > 0) {
                this.last_audible_volume = new_value
            }
        },
        /**
         * The speaker button toggles AUDIBILITY, not the `mute` flag.
         *
         * Those came apart in practice: `volume` at 0 is just as silent as
         * `mute`, and the button used to flip only the flag. Un-muting then
         * changed nothing you could hear, and the icon did not change either
         * (it shows the muted glyph for both states) — so the control looked
         * broken. On a phone that was a dead end: the volume slider is hidden
         * there, and the persisted 0 survived every reload.
         */
        toggleMute() {
            const { setMute, setVolume } = usePlayer()
            if (this.is_silent) {
                this.mute = false

                if (this.volume === 0) {
                    // `last_audible_volume` can itself be 0 on a profile that
                    // was saved in this state before the fix existed.
                    this.volume = this.last_audible_volume || 1.0
                    setVolume(this.volume)
                }
            } else {
                this.last_audible_volume = this.volume
                this.mute = true
            }

            setMute(this.mute)
        },
        initializeVolume() {
            const { setVolume, setMute } = usePlayer()

            // A phone never starts silent.
            //
            // `mute` and `volume` are persisted, but a phone-width viewport
            // renders no volume control outside the Now Playing page — the
            // bottom bar swaps the whole right group for the navigation. So a
            // silent state that survives a reload is an app that plays nothing
            // with no control in sight; for a first-time user it just looks
            // broken. On a phone the hardware volume rocker is the real volume
            // control anyway, which leaves an in-app mute nothing worth
            // restoring across sessions. Muting WITHIN a session still works
            // (and is undone from the bar, see BottomBar/Left.vue).
            //
            // Through the speaker button's own action, so startup recovers
            // exactly the way a tap does — including keeping a perfectly good
            // volume that merely happened to be muted, instead of resetting it.
            if (isMobile.value && this.is_silent) {
                this.toggleMute()
            }

            setVolume(this.volume)
            setMute(this.mute)
        },
        toggleLyricsPlugin() {
            pluginSetActive('lyrics_finder', !this.use_lyrics_plugin).then(() => {
                this.use_lyrics_plugin = !this.use_lyrics_plugin
            })
        },
        toggleLyricsAutoDownload() {
            const state = this.lyrics_plugin_settings.auto_download ? false : true

            updatePluginSettings('lyrics_finder', {
                ...this.lyrics_plugin_settings,
                auto_download: state,
            }).then(() => {
                this.lyrics_plugin_settings.auto_download = state
            })
        },
        toggleLyricsOverideUnsynced() {
            const state = this.lyrics_plugin_settings.overide_unsynced ? false : true

            updatePluginSettings('lyrics_finder', {
                ...this.lyrics_plugin_settings,
                overide_unsynced: state,
            }).then(() => {
                this.lyrics_plugin_settings.overide_unsynced = state
            })
        },
        // audio 👇
        toggleUseSilenceSkip() {
            this.use_silence_skip = !this.use_silence_skip
        },
        toggleCrossfade() {
            this.use_crossfade = !this.use_crossfade
        },
        setCrossfadeDuration(duration: number) {
            this.crossfade_duration = duration * 1000
        },

        toggleUseLegacyStreamingEndpoint() {
            this.use_legacy_streaming_endpoint = !this.use_legacy_streaming_endpoint
        },

        async genericToggleSetting(key: string, value: any, prop: string) {
            // @ts-expect-error
            const oldValue = this[prop]
            // @ts-expect-error
            this[prop] = value

            const res = await updateConfig(key, value)

            if (res.status !== 200) {
                prop = oldValue
                return false
            }

            return true
        },

        async updatePeriodicInterval(interval: number) {
            return await this.genericToggleSetting('scanInterval', interval, 'periodicInterval')
        },

        async toggleWatchdog() {
            return await this.genericToggleSetting('enableWatchDog', !this.enableWatchDog, 'enableWatchDog')
        },

        async togglePeriodicScans() {
            return await this.genericToggleSetting(
                'enablePeriodicScans',
                !this.enablePeriodicScans,
                'enablePeriodicScans'
            )
        },

        async toggleExtractFeaturedArtists() {
            return await this.genericToggleSetting('extractFeaturedArtists', !this.feat, 'feat')
        },

        async toggleRemoveProdBy() {
            return await this.genericToggleSetting('removeProdBy', !this.prodby, 'prodby')
        },

        async toggleRemoveRemasterInfo() {
            return await this.genericToggleSetting('removeRemasterInfo', !this.hide_remaster, 'hide_remaster')
        },

        async toggleCleanAlbumTitle() {
            return await this.genericToggleSetting('cleanAlbumTitle', !this.clean_titles, 'clean_titles')
        },

        async toggleMergeAlbums() {
            return await this.genericToggleSetting('mergeAlbums', !this.merge_albums, 'merge_albums')
        },

        async toggleShowAlbumsAsSingles() {
            return await this.genericToggleSetting(
                'showAlbumsAsSingles',
                !this.show_albums_as_singles,
                'show_albums_as_singles'
            )
        },
        async toggleShowPlaylistsInFolders() {
            return await this.genericToggleSetting('showPlaylistsInFolderView', !this.show_playlists_in_folders, 'show_playlists_in_folders'
            )
        },
        async setLastfmApiKey(key: string) {
            return await this.genericToggleSetting('lastfmApiKey', key, 'lastfm_api_key')
        },
        async setLastfmApiSecret(key: string) {
            return await this.genericToggleSetting('lastfmApiSecret', key, 'lastfm_api_secret')
        },
        async authorizeLastfmApiKey() {
            const getTokenUrl =
                'http://ws.audioscrobbler.com/2.0/?format=json&method=auth.getToken&api_key=' +
                this.lastfm_api_key +
                '&api_sig=' +
                getLastFmApiSig({ api_key: this.lastfm_api_key }, this.lastfm_api_secret)

            const data = await useAxios(
                {
                    url: getTokenUrl,
                    method: 'POST',
                },
                false
            )

            if (data.status !== 200) {
                return
            }

            this.lasftfm_token = data.data.token
            const url = 'https://www.last.fm/api/auth/?api_key=' + this.lastfm_api_key + '&token=' + this.lasftfm_token
            window.open(url, '_blank')
            this.lastfm_integration_started = true
        },
        async finishLastfmAuth() {
            const res = await useAxios({
                url: paths.api.plugins + '/lastfm/session/create',
                method: 'POST',
                props: {
                    token: this.lasftfm_token,
                },
            })

            if (res.status !== 200) {
                return
            }

            this.lastfm_session_key = res.data.session_key
            this.lastfm_integration_started = false
        },
        async disconnectLastfm() {
            const res = await useAxios({
                url: paths.api.plugins + '/lastfm/session/delete',
                method: 'POST',
            })

            if (res.status !== 200) {
                return
            }

            this.lastfm_session_key = ''
        },
        setStreamingQuality(quality: string) {
            this.streaming_quality = quality
        },
        setStatsGroup(group: string) {
            this.statsgroup = group
        },
        setStatsPeriod(period: string) {
            this.statsperiod = period
        },
    },
    getters: {
        crossfade_duration_seconds(): number {
            return this.crossfade_duration / 1000
        },
        crossfade_on(): boolean {
            return this.use_crossfade && this.crossfade_duration > 0
        },
        /**
         * No sound is coming out — muted, or turned all the way down. The two
         * are the same thing to a listener, so everything that reacts to
         * silence (the speaker glyph, its title, the mobile unmute button)
         * reads this one getter instead of restating the pair.
         */
        is_silent: state => state.mute || state.volume === 0,
        /**
         * The wide chrome: the top bar spans the full width and the left
         * sidebar sits underneath it. It used to be a choice ("Use no sidebar
         * layout"); the other grid — sidebar spanning the full height — was
         * only ever reachable by turning that option off, and it is what
         * phones get anyway. So the layout is no longer a setting, and this
         * getter is just the width guard: 900px is `ALL_MOBILE_WIDTH`, below
         * which App.vue drops the left sidebar entirely.
         */
        is_alt_layout: () => content_width.value > 900,
        highlightFavoriteTracks(): boolean {
            return (
                !router.currentRoute.value.name?.toString().toLowerCase().startsWith('favorite') &&
                this._highlightFavoriteTracks
            )
        },
    },
    persist: {
        afterRestore: context => {
            let store = context.store
            store.root_dirs = []
            store.root_dir_set = false

            // reset plugin settings
            store.use_lyrics_plugin = false
            store.lyrics_plugin_settings = {}
        },
    },
})
