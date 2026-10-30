<template>
    <!-- The records board (#540): facts about the whole history, not one period,
         so it has no period tabs. Counted hourly on the server. -->
    <section class="records" :aria-busy="loading">
        <h3 class="section-title">Records</h3>
        <p v-if="failed" class="records-note">The records could not be loaded.</p>
        <p v-else-if="data && !data.plays" class="records-note">Nothing played yet.</p>
        <ul v-else-if="data" class="records-list">
            <li v-if="data.longest_session" class="record">
                <span class="record-label">Longest session</span>
                <span class="record-value">{{ listened(data.longest_session.seconds) }}</span>
                <span class="record-text">
                    {{ momentLabel(data.longest_session.start) }} · {{ playCount(data.longest_session.plays) }}
                </span>
            </li>
            <li v-if="data.obsession" class="record">
                <span class="record-label">Obsession</span>
                <span class="record-value">{{ playCount(data.obsession.plays) }} in a day</span>
                <span class="record-text">
                    {{ trackName(data.obsession.track) }} · {{ dayLabel(data.obsession.day) }}
                </span>
            </li>
            <li v-for="milestone in data.milestones" :key="milestone.number" class="record">
                <span class="record-label">
                    {{ milestone.number === 1 ? 'Your very first play' : `Play #${milestone.number.toLocaleString('en')}` }}
                </span>
                <span class="record-text">
                    {{ trackName(milestone.track) }} · {{ momentLabel(milestone.timestamp) }}
                </span>
            </li>
        </ul>
    </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { getRecords } from '@/requests/stats'
import { dayLabel, listened, momentLabel, playCount } from '@/utils/rewind'

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
function trackName(track: RecordTrack | null): string {
    if (!track) return 'No longer in your library'
    const artists = track.artists.map(artist => artist.name).join(', ')
    return artists ? `${track.title} · ${artists}` : track.title
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
    padding: 1rem 1rem 0 0;

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
        border-radius: $candy-radius-sm;
        background-color: var(--mem-veil);
        color: $mem-content-faint;
    }

    .records-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
        // Room for the plates' offset shadows between and below them.
        gap: $medium;
        margin: 0;
        padding: 0 4px 4px 0;
        list-style: none;
    }

    // Each record is a reading plate like its neighbours on Stats (skip rate,
    // devices, calendar, clock): veil, frame, offset shadow. Without the frame
    // the veil alone read as a box with its edge missing.
    .record {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        padding: $small $medium;
        background-color: var(--mem-veil);
        border: $candy-border;
        border-radius: $candy-radius;
        @include candy-shadow;
    }

    .record-label {
        font-size: 0.8rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: $mem-content-faint;
    }

    .record-value {
        font-size: 1.25rem;
        font-weight: 700;
    }

    .record-text {
        overflow-wrap: anywhere;
        color: $mem-content-faint;
    }
}
</style>
