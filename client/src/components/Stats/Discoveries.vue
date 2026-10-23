<template>
    <!-- What the "new artists · new albums" tile counts (#539): everything first
         heard in the period, the latest discovery first. Opened from the tile. -->
    <section class="discoveries" :aria-busy="loading">
        <p v-if="failed" class="discoveries-note">What is new could not be loaded.</p>
        <template v-else-if="data">
            <p v-if="!data.artists.length && !data.albums.length" class="discoveries-note">
                Nothing heard for the first time {{ said }}.
            </p>
            <div v-if="data.artists.length" class="discoveries-group">
                <h3 class="section-title">New artists · {{ data.total.artists }}</h3>
                <CardRow :items="cards(data.artists)" />
            </div>
            <div v-if="data.albums.length" class="discoveries-group">
                <h3 class="section-title">New albums · {{ data.total.albums }}</h3>
                <CardRow :items="cards(data.albums)" />
            </div>
        </template>
    </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import CardRow from '@/components/shared/CardRow.vue'
import { getDiscoveries } from '@/requests/stats'

interface Card {
    type: 'album' | 'artist'
    item: Record<string, unknown>
}

interface Found {
    artists: Card[]
    albums: Card[]
    total: { artists: number; albums: number }
}

const props = defineProps<{ period: string }>()

const data = ref<Found | null>(null)
const failed = ref(false)
const loading = ref(false)

// As the tiles say it (`SAID_PERIOD` on the server).
const SAID: Record<string, string> = {
    day: 'today',
    week: 'this week',
    month: 'this month',
    year: 'this year',
    alltime: 'yet',
}
const said = computed(() => SAID[props.period] ?? `this ${props.period}`)

// CardRow picks the card by the item's own `type`; the server sends it beside.
function cards(found: Card[]) {
    return found.map(card => ({ ...card.item, type: card.type })) as never[]
}

// A quick switch of the period can overtake the answer before it.
let seq = 0
let alive = true
onBeforeUnmount(() => (alive = false))

async function load() {
    const mine = ++seq
    loading.value = true
    try {
        const res = await getDiscoveries(props.period)
        if (!alive || mine !== seq) return

        failed.value = res.status !== 200
        data.value = failed.value ? null : res.data
    } catch {
        if (alive && mine === seq) failed.value = true
    } finally {
        // Only the latest request may end the busy state.
        if (alive && mine === seq) loading.value = false
    }
}

watch(() => props.period, load, { immediate: true })
</script>

<style lang="scss">
.discoveries {
    padding: 1rem 1rem 0 0;

    .discoveries-group + .discoveries-group {
        margin-top: 1.5rem;
    }

    .section-title {
        @include mem-sticker;
        margin: 0 0 1rem 0;
        font-size: 1.15rem;
        font-weight: 700;
    }

    // Text on the doodled ground needs a plate (styling.md, `--mem-veil`).
    .discoveries-note {
        display: inline-block;
        margin: 0;
        padding: $small $medium;
        border-radius: $candy-radius-sm;
        background-color: var(--mem-veil);
        color: $mem-content-faint;
    }
}
</style>
