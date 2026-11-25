<template>
    <!-- The records board (#540): facts about the whole history, not one period,
         so it has no period tabs. Counted hourly on the server. -->
    <section class="records" :aria-busy="loading">
        <h3 class="section-title">Records</h3>
        <p v-if="failed" class="records-note">The records could not be loaded.</p>
        <p v-else-if="data && !data.plays" class="records-note">Nothing played yet.</p>
        <div v-else-if="data" class="records-plate">
            <!-- One anatomy for every tile: label, value (two lines of room),
                 the line under it, the moment at the foot. Every row as tall as
                 the tallest tile in it, so the tiles are one size. -->
            <ul class="records-list">
                <li v-if="data.longest_session" class="record" :style="{ '--record-accent': accentAt(0) }">
                    <span class="record-label">Longest session</span>
                    <span class="record-value">{{ listened(data.longest_session.seconds) }}</span>
                    <span class="record-text">{{ playCount(data.longest_session.plays) }}</span>
                    <span class="record-when">{{ momentLabel(data.longest_session.start) }}</span>
                </li>
                <li v-if="data.obsession" class="record" :style="{ '--record-accent': accentAt(1) }">
                    <span class="record-label">Obsession</span>
                    <span class="record-value">{{ playCount(data.obsession.plays) }} in a day</span>
                    <span class="record-text">{{ trackName(data.obsession.track) }}</span>
                    <span class="record-when">{{ dayLabel(data.obsession.day) }}</span>
                </li>
                <!-- A milestone has no figure of its own: its track is the news. -->
                <li
                    v-for="(milestone, i) in data.milestones"
                    :key="milestone.number"
                    class="record is-milestone"
                    :style="{ '--record-accent': accentAt(i + 2) }"
                >
                    <span class="record-label">
                        {{ milestone.number === 1 ? 'Your very first play' : `Play #${milestone.number.toLocaleString('en')}` }}
                    </span>
                    <span class="record-value" :title="trackTitle(milestone.track)">{{ trackTitle(milestone.track) }}</span>
                    <span v-if="milestone.track" class="record-text">{{ artistNames(milestone.track) }}</span>
                    <span class="record-when">{{ momentLabel(milestone.timestamp) }}</span>
                </li>
            </ul>
        </div>
    </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { getRecords } from '@/requests/stats'
import { dayLabel, listened, momentLabel, playCount } from '@/utils/rewind'
import { accentAt } from '@/utils/statAccents'

interface RecordTrack {
    title: string
    artists: { name: string }[]
}

interface RecordsPayload {
    plays: number
    longest_session: { start: number; end: number; seconds: number; plays: number } | null
    obsession: { track: RecordTrack | null; day: string; plays: number } | null
    milestones: { number: number; timestamp: number; track: RecordTrack | null }[]
}

const data = ref<RecordsPayload | null>(null)
const failed = ref(false)
const loading = ref(false)

// A track that has left the library has no card to name it by.
const GONE = 'No longer in your library'

function artistNames(track: RecordTrack): string {
    return track.artists.map(artist => artist.name).join(', ')
}

function trackName(track: RecordTrack | null): string {
    if (!track) return GONE
    const artists = artistNames(track)
    return artists ? `${track.title} · ${artists}` : track.title
}

function trackTitle(track: RecordTrack | null): string {
    return track ? track.title : GONE
}

onMounted(async () => {
    loading.value = true
    try {
        const res = await getRecords()
        failed.value = res.status !== 200
        data.value = failed.value ? null : res.data
    } catch {
        failed.value = true
    } finally {
        loading.value = false
    }
})
</script>

<style lang="scss">
.records {
    margin-top: 2rem;

    .section-title {
        @include mem-sticker;
        margin: 0 0 1rem 0;
        font-size: 1.15rem;
        font-weight: 700;
    }

    .records-note {
        display: inline-block;
        margin: 0;
        padding: $small $medium;
        border: $candy-border;
        border-radius: $candy-radius-sm;
        background-color: var(--mem-veil);
        color: $mem-content-faint;
        @include candy-shadow;
    }

    // One reading plate like its neighbours on Stats (skip rate, devices,
    // calendar, clock): veil, frame, offset shadow. The records stand on it
    // as panel cards, each under a label in its own accent.
    .records-plate {
        padding: 1rem;
        background-color: var(--mem-veil);
        border: $candy-border;
        border-radius: $candy-radius;
        @include candy-shadow;
        color: $mem-content-text;
    }

    .records-list {
        display: grid;
        // Equal tiles (2026-11-25): equal columns, and every row as tall as
        // its tallest tile. A minimum narrow enough that the usual five
        // records stand in one row on a desktop, none alone in a second.
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 12rem), 1fr));
        grid-auto-rows: 1fr;
        gap: $medium;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .record {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.35rem;
        min-width: 0;
        padding: 0.75rem;
        background-color: $mem-panel;
        border: $candy-border;
        border-radius: $candy-radius-sm;
        color: $mem-text;
    }

    .record-label {
        @include mem-sticker($fill: var(--look-stat-label-fill, var(--record-accent)), $pad: 0.15rem 0.55rem);
        margin-bottom: 0.2rem;
        font-size: 0.75rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        // A look without accent labels (Boring) keeps the word, in its grey.
        color: var(--look-stat-label-text, #{$mem-ink});
    }

    // Two lines of room for every value, so the lines under it start on one
    // height across a row; a longer title ends in an ellipsis (full in the tooltip).
    .record-value {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
        min-height: 2lh;
        overflow-wrap: anywhere;
        font-size: 1.4rem;
        font-weight: 800;
        line-height: 1.15;
    }

    .record-text {
        overflow-wrap: anywhere;
        font-size: 0.9rem;
        color: $mem-text-muted;
    }

    // The moment sits at the foot of every tile, on one line across a row.
    .record-when {
        margin-top: auto;
        font-size: 0.8rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: $mem-text-muted;
    }
}
</style>
