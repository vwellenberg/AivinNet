<template>
    <!-- Settings → Home: what the user said "Not interested" to (#531), and
         the way to take it back. Newest first, as the server lists them. -->
    <div class="not-interested">
        <p v-if="failed" class="not-interested-note">This list could not be loaded.</p>
        <p v-else-if="loaded && !items.length" class="not-interested-note">
            Nothing hidden. “Not interested” in the menu of a card in Never played or Artists you might like
            keeps it out of the row.
        </p>
        <ul v-else class="not-interested-list">
            <li v-for="item in items" :key="item.type + item.hash" class="not-interested-row">
                <img
                    v-if="item.image"
                    class="not-interested-art"
                    :class="{ 'is-round': item.type === 'artist' }"
                    :src="imageOf(item)"
                    alt=""
                    loading="lazy"
                />
                <span v-else class="not-interested-art" :class="{ 'is-round': item.type === 'artist' }"></span>
                <div class="not-interested-text">
                    <div class="not-interested-title">{{ item.title ?? 'No longer in your library' }}</div>
                    <div class="not-interested-desc">{{ describe(item) }}</div>
                </div>
                <button
                    type="button"
                    class="btn-pill not-interested-undo"
                    :disabled="busy.has(item.type + item.hash)"
                    :aria-label="`Suggest ${item.title ?? 'this ' + item.type} again`"
                    @click="takeBack(item)"
                >
                    Suggest again
                </button>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import { paths } from '@/config'
import { getNotInterested, NotInterestedItem, unmarkNotInterested } from '@/requests/home'
import useHome from '@/stores/home'
import { useToast } from '@/stores/notification'

const items = ref<NotInterestedItem[]>([])
const loaded = ref(false)
const failed = ref(false)
const busy = reactive(new Set<string>())

const toasts = useToast()
const home = useHome()

let alive = true
onBeforeUnmount(() => (alive = false))

onMounted(async () => {
    const res = await getNotInterested()
    if (!alive) return
    if (res.status === 200) {
        items.value = res.data.items
    } else {
        failed.value = true
    }
    loaded.value = true
})

function imageOf(item: NotInterestedItem) {
    return (item.type === 'album' ? paths.images.thumb.small : paths.images.artist.small) + item.image
}

function describe(item: NotInterestedItem) {
    if (item.type === 'artist') return 'Artist · Artists you might like'
    return item.subtitle ? `Album by ${item.subtitle} · Never played` : 'Album · Never played'
}

async function takeBack(item: NotInterestedItem) {
    const key = item.type + item.hash
    busy.add(key)
    const res = await unmarkNotInterested(item.type, item.hash)
    busy.delete(key)

    if (res.status !== 200) {
        toasts.showError(`Could not bring ${item.title ?? `the ${item.type}`} back`)
        return
    }

    items.value = items.value.filter(i => i !== item)
    // Home behind the settings window shows the card again if its row still
    // holds it; otherwise it may come back with the row's next draw.
    home.refreshIfLoaded()
}
</script>

<style lang="scss">
.not-interested {
    width: 100%;

    .not-interested-list {
        display: grid;
        gap: $small;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    // A plate around a picture, two lines and a button — like the rows of
    // the panel above (HomeRows.vue); the button is the control.
    .not-interested-row {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr) max-content;
        align-items: center;
        gap: $medium;
        min-height: $bar-control;
        padding: $small $medium $small $small;
        @include candy-box($mem-panel, $candy-radius-sm);
        @include candy-shadow(3px, 3px);
    }

    .not-interested-art {
        display: block;
        width: $bar-control;
        height: $bar-control;
        object-fit: cover;
        border: $mem-ring-w solid $mem-line;
        border-radius: $candy-radius-xs;

        &.is-round {
            border-radius: 50%;
        }
    }

    // Only the stand-in for a picture that is gone gets a fill. On an <img>
    // it would cover the tile the placeholder rule paints behind the server's
    // stand-in glyph (Global/cover-placeholders.scss) — ink on ink in the dark.
    span.not-interested-art {
        background-color: $mem-soft;
    }

    // A phone has no room for the button beside two lines: it goes under them.
    @include allPhones {
        .not-interested-row {
            grid-template-columns: max-content minmax(0, 1fr);
        }

        .not-interested-undo {
            grid-column: 2;
            justify-self: start;
        }
    }

    .not-interested-title {
        font-weight: 700;
    }

    .not-interested-desc {
        margin-top: 2px;
        font-size: 0.8rem;
        color: $mem-content-faint;
    }

    .not-interested-note {
        margin: 0;
        color: $mem-content-faint;
    }
}
</style>
