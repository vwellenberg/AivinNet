<template>
    <!-- AivinNet Rewind (#527): a year of listening, told in a handful of
         plates. Everything is computed on the server from the user's own
         plays; nothing here leaves it. -->
    <div class="content-page rewind-page" :style="{ background: brandGradient(BRAND_RED) }">
        <div class="rewind">
            <!-- Outside the year's data: a year that fails to load keeps the
                 way to the others. -->
            <div v-if="years.length > 1" class="rewind-years">
                <div class="seg" role="group" aria-label="Year">
                    <button
                        v-for="y in years"
                        :key="y"
                        type="button"
                        :class="{ active: y === shownYear }"
                        :aria-pressed="y === shownYear"
                        @click="showYear(y)"
                    >
                        {{ y }}
                    </button>
                </div>
            </div>

            <!-- A year opens on January 1 for the one that ended (#527): a link
                 or bookmark to a year still running lands here, not on a
                 retry that can only fail again. -->
            <section v-if="closedYear" class="rewind-plate rewind-hero">
                <h2 class="section-title">Rewind {{ closedYear }}</h2>
                <div class="rewind-sub">Opens on January 1, {{ closedYear + 1 }}, once the year is over.</div>
            </section>

            <section v-if="failed" class="rewind-plate rewind-hero">
                <h2 class="section-title">{{ shownYear ? `Rewind ${shownYear}` : 'Rewind' }}</h2>
                <div class="rewind-sub">This year could not be loaded.</div>
                <button type="button" class="btn-pill rewind-retry" @click="load">Try again</button>
            </section>

            <template v-if="data">
                <section class="rewind-plate rewind-hero">
                    <h2 class="section-title">Rewind {{ data.year }}</h2>
                    <template v-if="data.plays">
                        <div class="rewind-big">{{ minutes(data.seconds) }}</div>
                        <div class="rewind-label">minutes of music</div>
                        <div class="rewind-sub">{{ data.plays.toLocaleString('en') }} plays on {{ data.days }} days</div>
                    </template>
                    <div v-else class="rewind-sub">No music in {{ data.year }}.</div>
                </section>

                <template v-if="data.plays">
                    <section v-if="topArtist" class="rewind-plate">
                        <h2 class="section-title">Your top artist</h2>
                        <div class="rewind-feature">
                            <img
                                v-if="topArtist.image"
                                class="rewind-cover is-round"
                                :src="paths.images.artist.medium + topArtist.image"
                                alt=""
                            />
                            <div>
                                <RouterLink class="rewind-name" :to="{ name: Routes.artist, params: { hash: topArtist.artisthash } }">
                                    {{ topArtist.name }}
                                </RouterLink>
                                <div class="rewind-label">{{ listened(topArtist.seconds ?? 0) }}</div>
                            </div>
                        </div>
                        <ol class="rewind-list">
                            <li v-for="a in data.top_artists.slice(1)" :key="a.artisthash">
                                <span>{{ a.name }}</span>
                                <span class="rewind-time">{{ listened(a.seconds ?? 0) }}</span>
                            </li>
                        </ol>
                    </section>

                    <section v-if="topAlbum" class="rewind-plate">
                        <h2 class="section-title">Your top album</h2>
                        <div class="rewind-feature">
                            <img class="rewind-cover" :src="paths.images.thumb.medium + topAlbum.image" alt="" />
                            <div>
                                <RouterLink class="rewind-name" :to="{ name: Routes.album, params: { albumhash: topAlbum.albumhash } }">
                                    {{ topAlbum.title }}
                                </RouterLink>
                                <div class="rewind-label">{{ albumLine(topAlbum) }}</div>
                            </div>
                        </div>
                        <ol class="rewind-list">
                            <li v-for="a in data.top_albums.slice(1)" :key="a.albumhash">
                                <span>{{ a.title }}</span>
                                <span class="rewind-time">{{ listened(a.seconds ?? 0) }}</span>
                            </li>
                        </ol>
                    </section>

                    <section v-if="data.top_tracks.length" class="rewind-plate">
                        <h2 class="section-title">Your top tracks</h2>
                        <ol class="rewind-list is-numbered">
                            <li v-for="t in data.top_tracks" :key="t.trackhash">
                                <span>{{ trackLine(t) }}</span>
                                <!-- The measure they are ranked by, like the artists and albums beside them. -->
                                <span class="rewind-time">{{ listened(t.seconds ?? 0) }}</span>
                            </li>
                        </ol>
                    </section>

                    <section v-if="data.summer_track" class="rewind-plate">
                        <h2 class="section-title">Song of your summer</h2>
                        <div class="rewind-name">{{ trackLine(data.summer_track.track) }}</div>
                        <div class="rewind-label">{{ playCount(data.summer_track.plays) }} from June to August</div>
                    </section>

                    <section v-if="data.first_track" class="rewind-plate">
                        <h2 class="section-title">Where it started</h2>
                        <div class="rewind-name">{{ trackLine(data.first_track.track) }}</div>
                        <div class="rewind-label">your first play, {{ momentLabel(data.first_track.timestamp) }}</div>
                    </section>

                    <section v-if="data.busiest_day" class="rewind-plate">
                        <h2 class="section-title">Your biggest day</h2>
                        <div class="rewind-name">{{ dayLabel(data.busiest_day.date) }}</div>
                        <div class="rewind-label">{{ listened(data.busiest_day.seconds) }} of music</div>
                    </section>

                    <section v-if="data.new_artists" class="rewind-plate">
                        <h2 class="section-title">New to you</h2>
                        <div class="rewind-big">{{ data.new_artists }}</div>
                        <div class="rewind-label">
                            {{ data.new_artists === 1 ? 'artist' : 'artists' }} you had never played before
                        </div>
                        <div v-if="data.new_artists_top.length" class="rewind-sub">
                            Most of all {{ names(data.new_artists_top) }}
                        </div>
                    </section>

                    <section v-if="listener" class="rewind-plate">
                        <h2 class="section-title">How you listen</h2>
                        <div class="rewind-name">{{ listener.title }}</div>
                        <div class="rewind-label">{{ listener.share }} of your plays</div>
                        <div class="rewind-sub">{{ listener.line }}</div>
                        <div v-if="data.time_of_day" class="rewind-sub">
                            Mostly {{ bandPhrase(data.time_of_day.band) }} — {{ percent(data.time_of_day.share) }} of it.
                        </div>
                    </section>
                </template>

                <!-- The end of the year (#572): reaching it marks the Rewind
                     seen, and it stops announcing itself. Not on opening: a
                     look at the first plate is no Rewind seen. -->
                <div ref="end" class="rewind-end" aria-hidden="true"></div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { paths } from '@/config'
import { getRewind, markRewindSeen } from '@/requests/stats'
import { Routes } from '@/router'
import { brandGradient, BRAND_RED } from '@/utils/colortools/pageGradient'
import {
    RewindPayload,
    albumLine,
    bandPhrase,
    dayLabel,
    listened,
    listenerText,
    minutes,
    momentLabel,
    names,
    percent,
    playCount,
    trackLine,
} from '@/utils/rewind'
import updatePageTitle from '@/utils/updatePageTitle'

const route = useRoute()
const router = useRouter()
const data = ref<RewindPayload | null>(null)
// The years kept apart from the year's data, which a failed load clears.
const years = ref<number[]>([])
const failed = ref(false)
// The year asked for when it is still running (404): it has no Rewind yet.
const closedYear = ref<number | null>(null)
const shownYear = computed(() => data.value?.year ?? (Number(route.params.year) || null))

const topArtist = computed(() => data.value?.top_artists[0])
const topAlbum = computed(() => data.value?.top_albums[0])
const listener = computed(() => listenerText(data.value?.listener ?? null))

// Seen to the end (#572): the sentinel after the last plate, in view for a
// moment — a short year on a tall screen shows its end on opening, and a
// glance is no Rewind seen. Once per year and page; a failed request tries
// again the next time the end comes into view, a 403 (the shared guest
// account) is an answer.
const SEEN_AFTER_MS = 2500
const end = ref<HTMLElement | null>(null)
const marked = new Set<number>()
let watcher: IntersectionObserver | null = null
let dwell: ReturnType<typeof setTimeout> | undefined

function stopWatching() {
    clearTimeout(dwell)
    watcher?.disconnect()
    watcher = null
}

function watchEnd() {
    stopWatching()
    const year = data.value?.year
    if (!year || marked.has(year) || !end.value || typeof IntersectionObserver !== 'function') return
    watcher = new IntersectionObserver(entries => {
        clearTimeout(dwell)
        if (!entries.some(e => e.isIntersecting)) return
        dwell = setTimeout(async () => {
            const res = await markRewindSeen(year)
            if (res?.status === 200 || res?.status === 403) {
                marked.add(year)
                if (data.value?.year === year) stopWatching()
            }
        }, SEEN_AFTER_MS)
    })
    watcher.observe(end.value)
}
onUnmounted(stopWatching)

// Only the newest year may paint: a quick switch must not land on the year
// that answered last.
let seq = 0
let alive = true
onUnmounted(() => (alive = false))

async function load() {
    const year = Number(route.params.year) || undefined
    const mine = ++seq
    const res = await getRewind(year)
    if (!alive || mine !== seq) return

    const ok = res.status === 200
    // Only the server's own answer says "not yet": a 404 from anything in
    // between (an older backend, a proxy) is a failure to retry.
    const notYet = res.status === 404 && Boolean(res.data?.opens)
    data.value = ok ? res.data : null
    closedYear.value = notYet && year ? year : null
    failed.value = !ok && !closedYear.value
    // The "not yet" answer brings the years that are open: a bookmark to this
    // year still finds the way to the last one.
    if (ok || notYet) years.value = res.data.years ?? []
    updatePageTitle(data.value ? `Rewind ${data.value.year}` : 'Rewind')
    await nextTick()
    watchEnd()
}

function showYear(year: number) {
    router.replace({ name: Routes.Rewind, params: { year } })
}

onMounted(load)
// Leaving the page clears the param too: that is not a year to load.
watch(
    () => route.params.year,
    () => route.name === Routes.Rewind && load()
)
</script>

<style lang="scss">
.rewind-page {
    height: 100%;
    overflow: auto;
}

.rewind {
    display: grid;
    gap: 1.5rem;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
    align-items: start;
    max-width: 72rem;

    // The sentinel after the last plate: a full row, no height of its own.
    .rewind-end {
        grid-column: 1 / -1;
        height: 1px;
        margin-top: -1.5rem;
    }

    .rewind-years,
    .rewind-hero {
        grid-column: 1 / -1;
    }

    .rewind-retry {
        margin-top: $medium;
    }

    .rewind-years {
        @include mem-seg-scroll;
    }

    .seg {
        @include mem-seg-tabs;
    }

    .section-title {
        @include mem-sticker;
        margin: 0 0 1rem 0;
        font-size: 1.05rem;
        font-weight: 700;
    }

    // A reading plate on the doodled ground (styling.md, `--mem-veil`). Not
    // pressable, so no hatch and no role.
    .rewind-plate {
        // A grid item sizes to its content by default; a long title would
        // push the plate past its column.
        min-width: 0;
        padding: 1.25rem;
        background-color: var(--mem-veil);
        border: $candy-border;
        border-radius: $candy-radius;
        @include candy-shadow;
        color: $mem-content-text;
        // The large plates' arrival (modal, Continue card) — in the motion
        // policy and the one-shot latch, unlike a hand-made keyframe.
        animation: mem-plate-rise $motion-settle ease-out;
    }

    // The year itself: one accent plate, ink on a pastel in both modes.
    .rewind-hero {
        background-color: mem-pastel($mem-lavender);
        color: $mem-ink;
    }

    .rewind-big {
        font-size: 3.5rem;
        font-weight: 900;
        line-height: 1;
    }

    .rewind-name {
        display: block;
        overflow-wrap: anywhere;
        font-size: 1.4rem;
        font-weight: 900;
        line-height: 1.2;
        color: inherit;
    }

    .rewind-label {
        margin-top: $small;
        font-size: 0.85rem;
        font-weight: 700;
        text-transform: uppercase;
        color: $mem-content-faint;
    }

    .rewind-hero .rewind-label {
        color: inherit;
    }

    .rewind-sub {
        margin-top: $medium;
        font-weight: 700;
    }

    .rewind-feature {
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    .rewind-cover {
        width: 5rem;
        height: 5rem;
        flex-shrink: 0;
        object-fit: cover;
        border: $candy-border;
        border-radius: $candy-radius-sm;

        &.is-round {
            border-radius: 50%;
        }
    }

    .rewind-list {
        margin: 1rem 0 0 0;
        padding: 0;
        list-style: none;
        display: grid;
        // One column that may be narrower than its longest row. The implicit
        // track is `auto`, which grows to the longest unbroken title and
        // pushed the rows past the plate (Rewind's top albums, 2026-10-23);
        // the title's ellipsis only works inside a track that can shrink.
        grid-template-columns: minmax(0, 1fr);
        gap: $small;

        &.is-numbered {
            margin-top: 0;
            counter-reset: rank;

            li::before {
                counter-increment: rank;
                content: counter(rank) '.';
                font-weight: 900;
                // Equal digits and one width, so the titles start on one line.
                font-variant-numeric: tabular-nums;
                min-width: 1.5em;
            }
        }

        li {
            display: flex;
            gap: $small;
            align-items: baseline;

            span:first-of-type {
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        }
    }

    .rewind-time {
        font-size: 0.8rem;
        font-weight: 700;
        color: $mem-content-faint;
        white-space: nowrap;
    }
}
</style>
