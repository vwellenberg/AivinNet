<template>
    <div id="right-tabs" :class="{ tabContent: tabContent }">
        <div ref="list" class="tabheaders" role="tablist" aria-label="Search results filter">
            <button
                v-for="tab in tabs"
                :key="tab"
                class="tab circular"
                :class="{ activetab: tab === currentTab }"
                role="tab"
                :aria-selected="tab === currentTab"
                :tabindex="tab === currentTab ? 0 : -1"
                @click="$emit('switchTab', tab)"
                @keydown="onKeydown"
            >
                {{ tab }}
            </button>
        </div>

        <div v-if="tabContent" id="tab-content" role="tabpanel" v-auto-animate>
            <slot />
        </div>
    </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'

const props = defineProps<{
    tabs: string[]
    currentTab: string
    tabContent?: boolean
}>()

const emit = defineEmits<{
    (e: 'switchTab', tab: string): void
}>()

const list = ref<HTMLElement>()

// The chips are a tablist, so the arrow keys move within the group and Tab
// steps over it — that is why only the selected chip is in the tab order
// (roving tabindex). Without the pattern the row was six buttons that a
// screen reader could not tell apart: `aria-selected` needs `role="tab"` to
// mean anything, and the selected state was carried by colour alone.
function onKeydown(e: KeyboardEvent) {
    const i = props.tabs.indexOf(props.currentTab)
    const last = props.tabs.length - 1
    let next: number

    switch (e.key) {
        case 'ArrowRight':
            next = i >= last ? 0 : i + 1
            break
        case 'ArrowLeft':
            next = i <= 0 ? last : i - 1
            break
        case 'Home':
            next = 0
            break
        case 'End':
            next = last
            break
        default:
            return
    }

    e.preventDefault()
    emit('switchTab', props.tabs[next])
    // Focus follows selection, and it has to wait for the re-render: the
    // chip it moves to only becomes focusable once `tabindex` flips to 0.
    nextTick(() => {
        list.value?.querySelectorAll<HTMLElement>('.tab')[next]?.focus()
    })
}
</script>

<style lang="scss">
#right-tabs {
    display: grid;
    width: 100%;

    .tab-buttons-wrapper {
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .vue-recycle-scroller {
        padding: 0 $small;
    }

    #tracks-results > .vue-recycle-scroller {
        padding: unset;
    }

    .cardlistrow {
        grid-template-columns: repeat(auto-fill, minmax(8.1rem, 1fr));
    }
}

#tab-content {
    height: 100%;
    overflow: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
}

.designatedOS #tab-content::-webkit-scrollbar-track {
    background-color: $gray;
}

.designatedOS #tab-content::-webkit-scrollbar-thumb {
    border-color: $gray;
}

.designatedOS #tab-content .vue-recycle-scroller::-webkit-scrollbar-track {
    background-color: $gray;
}

.designatedOS #tab-content .vue-recycle-scroller::-webkit-scrollbar-thumb {
    border-color: $gray;
}

// ⚠️ The absolute box belongs to the CONTENT case, not to the chip row.
//
// It exists so the tab content can fill the sidebar panel and scroll inside
// it. The search view passes no content — it renders the chips alone — and
// there the same box became a clip frame exactly as tall as one chip, which
// shaved the bottom off every chip's offset shadow. The shadow was still
// declared, still in the computed style, and simply not painted.
#right-tabs.tabContent {
    grid-template-rows: min-content 1fr;
    position: absolute; // TODO: Find a way to fix scrollability without using position absolute.
    overflow: hidden;
    height: 100%;
}
</style>
